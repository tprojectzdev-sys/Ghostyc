import Foundation

struct WsEnvelope: Codable {
    let v: Int
    let type: String
    let id: String
    let request_id: String?
    let correlation_id: String?
    let ts: String
    let data: AnyCodable?
}

enum WebSocketConnectionState: String {
    case connecting
    case connected
    case disconnected
    case reconnecting
    case failed
}

struct DeviceStatusEvent: Identifiable {
    let id = UUID()
    let deviceId: String
    let role: String
    let status: String
    let lastHeartbeat: String?
    let reconnectCount: Int
    let reason: String?
    let receivedAt: Date
}

struct CommandResultEvent: Identifiable {
    let id = UUID()
    let requestId: String
    let state: String
    let finishedAt: String?
    let errorCode: String?
    let errorMessage: String?
    let receivedAt: Date
}

struct HeartbeatEvent: Identifiable {
    let id = UUID()
    let deviceId: String
    let role: String
    let uptimeS: Double?
    let version: String?
    let receivedAt: Date
}

@MainActor
class WebSocketClient: ObservableObject {
    static let shared = WebSocketClient()

    @Published var connectionState: WebSocketConnectionState = .disconnected
    @Published var sessionId: String?
    @Published var lastDeviceStatusEvent: DeviceStatusEvent?
    @Published var lastCommandResultEvent: CommandResultEvent?
    @Published var lastLogEvent: LogEntry?
    @Published var lastHeartbeatEvent: HeartbeatEvent?
    @Published var lastUnknownEventType: String?
    @Published var lastErrorMessage: String?

    private var webSocket: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private var reconnectAttempt = 0
    private var reconnectWork: DispatchWorkItem?

    private let protocolVersion = "1.0.0-draft"
    private let clientVersion = "0.1.0"
    private let decoder = JSONDecoder()

    func connect() {
        guard let token = KeychainHelper.load(key: "ghostyc_token") else { return }
        reconnectWork?.cancel()
        connectionState = reconnectAttempt == 0 ? .connecting : .reconnecting

        let baseURL = UserDefaults.standard.string(forKey: "relay_url") ?? "http://localhost:8080"
        let wsURL = baseURL
            .replacingOccurrences(of: "https://", with: "wss://")
            .replacingOccurrences(of: "http://", with: "ws://")

        guard let url = URL(string: "\(wsURL)/ws/client") else {
            connectionState = .failed
            lastErrorMessage = "Invalid relay URL"
            return
        }

        urlSession = URLSession(configuration: .default)
        webSocket = urlSession?.webSocketTask(with: url)
        webSocket?.resume()

        sendHello(token: token)
        receiveLoop()
    }

    func disconnect() {
        reconnectWork?.cancel()
        webSocket?.cancel(with: .normalClosure, reason: nil)
        webSocket = nil
        connectionState = .disconnected
        sessionId = nil
    }

    // MARK: - Private

    private func sendHello(token: String) {
        let hello: [String: Any] = [
            "v": 1,
            "type": "hello",
            "id": UUID().uuidString,
            "request_id": NSNull(),
            "correlation_id": NSNull(),
            "ts": ISO8601DateFormatter().string(from: Date()),
            "data": [
                "role": "client",
                "device_id": "iphone",
                "token": token,
                "version": clientVersion,
                "protocol_version": protocolVersion,
            ] as [String: Any],
        ]

        guard let data = try? JSONSerialization.data(withJSONObject: hello),
              let text = String(data: data, encoding: .utf8) else { return }

        webSocket?.send(.string(text)) { [weak self] error in
            if error != nil {
                Task { @MainActor in self?.handleDisconnect() }
            }
        }
    }

    private func receiveLoop() {
        webSocket?.receive { [weak self] result in
            Task { @MainActor in
                guard let self = self else { return }
                switch result {
                case .success(.string(let text)):
                    self.handleMessage(text)
                case .success(.data(let data)):
                    if let text = String(data: data, encoding: .utf8) {
                        self.handleMessage(text)
                    }
                case .failure(let error):
                    self.lastErrorMessage = error.localizedDescription
                    self.handleDisconnect()
                    return
                default:
                    break
                }
                self.receiveLoop()
            }
        }
    }

    private func handleMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let envelope = try? decoder.decode(WsEnvelope.self, from: data) else { return }

        if envelope.type == "welcome" {
            connectionState = .connected
            reconnectAttempt = 0
            if let welcomeData = envelope.data?.value as? [String: Any] {
                sessionId = welcomeData["session_id"] as? String
            }
        } else if envelope.type == "error" {
            if let errData = envelope.data?.value as? [String: Any] {
                let code = errData["code"] as? String ?? "ws.error"
                let message = errData["message"] as? String ?? "Unknown websocket error"
                lastErrorMessage = "\(code): \(message)"
            }
            connectionState = .failed
        } else if envelope.type == "device.status" {
            if let event = parseDeviceStatus(envelope: envelope) {
                lastDeviceStatusEvent = event
            }
        } else if envelope.type == "command.result" {
            if let event = parseCommandResult(envelope: envelope) {
                lastCommandResultEvent = event
            }
        } else if envelope.type == "log.event" {
            if let event = parseLogEvent(envelope: envelope) {
                lastLogEvent = event
            }
        } else if envelope.type == "heartbeat" || envelope.type == "pong" {
            if let event = parseHeartbeat(envelope: envelope) {
                lastHeartbeatEvent = event
            }
        } else {
            lastUnknownEventType = envelope.type
            print("[ws] unknown event type:", envelope.type)
        }
    }

    private func handleDisconnect() {
        connectionState = .disconnected
        sessionId = nil
        webSocket = nil
        scheduleReconnect()
    }

    private func scheduleReconnect() {
        guard KeychainHelper.load(key: "ghostyc_token") != nil else { return }

        let attempt = reconnectAttempt
        reconnectAttempt += 1
        connectionState = .reconnecting

        var delay: Double
        if attempt < 10 {
            delay = min(pow(2.0, Double(attempt)), 30.0)
        } else {
            delay = 300.0
        }
        let jitter = delay * 0.2 * (Double.random(in: -1...1))
        delay = max(0.5, delay + jitter)

        reconnectWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            Task { @MainActor in self?.connect() }
        }
        reconnectWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    // MARK: - Event parsing

    private func parseDeviceStatus(envelope: WsEnvelope) -> DeviceStatusEvent? {
        guard let payload = envelope.data?.value as? [String: Any] else { return nil }
        return DeviceStatusEvent(
            deviceId: payload["device_id"] as? String ?? "unknown",
            role: payload["role"] as? String ?? "unknown",
            status: payload["status"] as? String ?? "unknown",
            lastHeartbeat: payload["last_heartbeat"] as? String,
            reconnectCount: payload["reconnect_count"] as? Int ?? 0,
            reason: payload["reason"] as? String,
            receivedAt: Date()
        )
    }

    private func parseCommandResult(envelope: WsEnvelope) -> CommandResultEvent? {
        guard let payload = envelope.data?.value as? [String: Any],
              let requestId = envelope.request_id else { return nil }
        let errorPayload = payload["error"] as? [String: Any]
        return CommandResultEvent(
            requestId: requestId,
            state: payload["state"] as? String ?? "unknown",
            finishedAt: payload["finished_at"] as? String,
            errorCode: errorPayload?["code"] as? String,
            errorMessage: errorPayload?["message"] as? String,
            receivedAt: Date()
        )
    }

    private func parseLogEvent(envelope: WsEnvelope) -> LogEntry? {
        guard let payload = envelope.data?.value as? [String: Any],
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let entry = try? decoder.decode(LogEntry.self, from: data) else { return nil }
        return entry
    }

    private func parseHeartbeat(envelope: WsEnvelope) -> HeartbeatEvent? {
        guard let payload = envelope.data?.value as? [String: Any] else { return nil }
        return HeartbeatEvent(
            deviceId: payload["device_id"] as? String ?? "unknown",
            role: payload["role"] as? String ?? "unknown",
            uptimeS: payload["uptime_s"] as? Double,
            version: payload["version"] as? String,
            receivedAt: Date()
        )
    }
}

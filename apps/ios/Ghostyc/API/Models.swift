import Foundation

// MARK: - Auth

struct LoginRequest: Encodable {
    let password: String
}

struct LoginResponse: Decodable {
    let token: String
    let expires_at: String?
    let request_id: String
}

struct WhoamiResponse: Decodable {
    let role: String
    let server_time: String
    let protocol_version: String
    let request_id: String
}

// MARK: - Devices

struct DevicesResponse: Decodable {
    let devices: [DeviceSnapshot]
    let request_id: String
}

struct DeviceSnapshot: Decodable, Identifiable {
    let device_id: String
    let role: String
    let status: String
    let last_heartbeat: String?
    let connected_since: String?
    let reconnect_count: Int
    let version: String?

    var id: String { device_id }
    var isOnline: Bool { status == "online" }
}

// MARK: - Commands

struct PostCommandRequest: Encodable {
    let target: String
    let command: String
    let args: [String: AnyCodable]
    let timeout_ms: Int?
}

struct CommandAccepted: Decodable {
    let request_id: String
    let status: String
    let submitted_at: String
}

struct CommandRecord: Decodable, Identifiable {
    let request_id: String
    let state: String
    let submitted_at: String
    let started_at: String?
    let finished_at: String?
    let result: AnyCodable?
    let error: ErrorObject?

    var id: String { request_id }
}

struct ErrorObject: Decodable {
    let code: String
    let message: String
}

// MARK: - Logs

struct LogsResponse: Decodable {
    let logs: [LogEntry]
    let request_id: String
}

struct LogEntry: Decodable, Identifiable {
    let timestamp: String
    let service: String
    let device: String
    let level: String
    let event: String
    let message: String
    let request_id: String?
    let command: String?
    let status: String?
    let duration_ms: Double?
    let error: ErrorObject?

    var id: String { "\(timestamp)-\(event)-\(request_id ?? UUID().uuidString)" }
}

// MARK: - Diagnostics

struct DiagnosticsSnapshot: Decodable {
    let relay: RelayDiag
    let agent: AgentDiag?
    let bridge: BridgeDiag?
    let auth: AuthDiag
    let request_id: String
}

struct RelayDiag: Decodable {
    let status: String
    let uptime_s: Double
    let protocol_version: String
    let ws_clients_connected: Int
    let log_buffer_size: Int
    let log_buffer_capacity: Int
    let persistent_logs: PersistentLogsDiag
}

struct PersistentLogsDiag: Decodable {
    let enabled: Bool
    let dir: String?
}

struct AgentDiag: Decodable {
    let device_id: String
    let role: String
    let status: String
    let last_heartbeat: String?
    let connected_since: String?
    let reconnect_count: Int
    let version: String?
    let last_command: LastCommandDiag?
    let last_error: ErrorObject?

    var isOnline: Bool { status == "online" }
}

struct LastCommandDiag: Decodable {
    let request_id: String
    let command: String
    let state: String
    let finished_at: String?
}

struct BridgeDiag: Decodable {
    let device_id: String
    let role: String
    let status: String
    let last_heartbeat: String?
    let version: String?
    let last_wake_attempt: String?
    let last_error: ErrorObject?

    var isOnline: Bool { status == "online" }
}

struct AuthDiag: Decodable {
    let client_token_present: Bool
    let agent_token_present: Bool
    let bridge_token_present: Bool
}

// MARK: - Health

struct HealthResponse: Decodable {
    let status: String
    let uptime_s: Double
    let protocol_version: String
}

// MARK: - AnyCodable (lightweight type-erased Codable)

struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            value = NSNull()
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map(\.value)
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues(\.value)
        } else {
            value = NSNull()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case is NSNull:
            try container.encodeNil()
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        default:
            try container.encodeNil()
        }
    }
}

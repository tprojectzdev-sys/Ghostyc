import SwiftUI

struct DiagnosticsView: View {
    @EnvironmentObject private var wsClient: WebSocketClient
    @State private var diag: DiagnosticsSnapshot?
    @State private var healthMs: Int?
    @State private var isLoading = true
    @State private var lastCheck = Date()
    @State private var liveAgentStatus: String = "unknown"
    @State private var liveBridgeStatus: String = "unknown"
    @State private var liveLastCommand: String = "unknown"

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    diagCard(
                        title: "REST API Health",
                        icon: "server.rack",
                        status: healthMs != nil ? .ok : .error,
                        desc: "Testing standard HTTP endpoints.",
                        result: healthMs != nil ? "200 OK — \(healthMs!)ms" : "Unreachable"
                    )

                    diagCard(
                        title: "WebSocket Connection",
                        icon: "wave.3.right",
                        status: wsDiagStatus,
                        desc: "Realtime channel state from iPhone to relay.",
                        result: "State: \(connectionLabel.uppercased()) | Session: \(wsClient.sessionId?.prefix(8) ?? "none")"
                    )

                    diagCard(
                        title: "Relay Status",
                        icon: "server.rack",
                        status: diag?.relay.status == "ok" ? .ok : .warning,
                        desc: "Relay uptime and log buffer.",
                        result: diag.map { d in
                            "Uptime: \(formatUptime(d.relay.uptime_s)) | Logs: \(d.relay.log_buffer_size)/\(d.relay.log_buffer_capacity) | WS: \(d.relay.ws_clients_connected)"
                        } ?? "Loading..."
                    )

                    diagCard(
                        title: "Windows Agent",
                        icon: "desktopcomputer",
                        status: agentDiagStatus,
                        desc: "Agent connectivity.",
                        result: diag?.agent.map { a in
                            "\(liveAgentStatus.uppercased()) | v\(a.version ?? "?") | Reconnects: \(a.reconnect_count)"
                        } ?? "Agent has never connected"
                    )

                    diagCard(
                        title: "WoL Bridge",
                        icon: "antenna.radiowaves.left.and.right",
                        status: bridgeDiagStatus,
                        desc: "Wake bridge connectivity.",
                        result: diag?.bridge.map { b in
                            "\(liveBridgeStatus.uppercased()) | v\(b.version ?? "?")"
                        } ?? "Not connected (Phase 5)"
                    )

                    diagCard(
                        title: "Last Agent Command",
                        icon: "arrow.clockwise",
                        status: liveCommandDiagStatus,
                        desc: "Most recent command to the agent.",
                        result: liveLastCommand
                    )

                    diagCard(
                        title: "Auth Tokens",
                        icon: "key.fill",
                        status: diag?.auth.client_token_present == true && diag?.auth.agent_token_present == true ? .ok : .error,
                        desc: "Required auth tokens configured.",
                        result: diag.map { d in
                            "Client: \(d.auth.client_token_present ? "Set" : "MISSING") | Agent: \(d.auth.agent_token_present ? "Set" : "MISSING") | Bridge: \(d.auth.bridge_token_present ? "Set" : "N/A")"
                        } ?? "Loading..."
                    )
                }
                .padding()
            }
            .background(GhostycTheme.background)
            .navigationTitle("Diagnostics")
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { Task { await loadDiag() } }) {
                        if isLoading {
                            ProgressView().tint(.white).scaleEffect(0.8)
                        } else {
                            Image(systemName: "arrow.clockwise").foregroundColor(.white)
                        }
                    }
                }
            }
        }
        .task { await loadDiag() }
        .refreshable { await loadDiag() }
        .onChange(of: wsClient.lastDeviceStatusEvent?.id) { _ in
            guard let event = wsClient.lastDeviceStatusEvent else { return }
            if event.role == "agent" { liveAgentStatus = event.status }
            if event.role == "bridge" { liveBridgeStatus = event.status }
        }
        .onChange(of: wsClient.lastCommandResultEvent?.id) { _ in
            guard let event = wsClient.lastCommandResultEvent else { return }
            liveLastCommand = "\(event.state.uppercased()) (\(event.requestId.prefix(8)))"
        }
    }

    private func loadDiag() async {
        isLoading = true
        do {
            let start = Date()
            _ = try await APIClient.shared.health()
            healthMs = Int(Date().timeIntervalSince(start) * 1000)
        } catch {
            healthMs = nil
        }
        do {
            diag = try await APIClient.shared.diagnostics()
            lastCheck = Date()
            liveAgentStatus = diag?.agent?.status ?? "unknown"
            liveBridgeStatus = diag?.bridge?.status ?? "unknown"
            if let cmd = diag?.agent?.last_command {
                liveLastCommand = "\(cmd.command) → \(cmd.state) (\(cmd.request_id.prefix(8)))"
            } else {
                liveLastCommand = "No commands sent yet"
            }
        } catch {
            // keep stale
        }
        isLoading = false
    }

    enum DiagStatus { case ok, warning, error }

    private func diagCard(title: String, icon: String, status: DiagStatus, desc: String, result: String) -> some View {
        GhostycCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label(title, systemImage: icon)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.white)
                    Spacer()
                    statusIcon(status)
                }

                Text(desc)
                    .font(.system(size: 12))
                    .foregroundColor(GhostycTheme.textTertiary)

                Text(result)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(GhostycTheme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(Color.black.opacity(0.3))
                    .cornerRadius(8)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.white.opacity(0.05), lineWidth: 1))
            }
        }
    }

    @ViewBuilder
    private func statusIcon(_ status: DiagStatus) -> some View {
        switch status {
        case .ok:
            Image(systemName: "checkmark.circle.fill")
                .foregroundColor(GhostycTheme.textSecondary)
        case .warning:
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundColor(GhostycTheme.textTertiary)
        case .error:
            Image(systemName: "xmark.circle.fill")
                .foregroundColor(GhostycTheme.textTertiary)
        }
    }

    private func formatUptime(_ s: Double) -> String {
        let total = Int(s)
        let d = total / 86400
        let h = (total % 86400) / 3600
        let m = (total % 3600) / 60
        if d > 0 { return "\(d)d \(h)h \(m)m" }
        if h > 0 { return "\(h)h \(m)m" }
        return "\(m)m \(total % 60)s"
    }

    private var connectionLabel: String {
        switch wsClient.connectionState {
        case .connected: return "connected"
        case .connecting: return "connecting"
        case .reconnecting: return "reconnecting"
        case .disconnected: return "disconnected"
        case .failed: return "failed"
        }
    }

    private var wsDiagStatus: DiagStatus {
        switch wsClient.connectionState {
        case .connected: return .ok
        case .connecting, .reconnecting: return .warning
        case .disconnected, .failed: return .error
        }
    }

    private var agentDiagStatus: DiagStatus {
        switch liveAgentStatus {
        case "online": return .ok
        case "offline": return .error
        default: return .warning
        }
    }

    private var bridgeDiagStatus: DiagStatus {
        switch liveBridgeStatus {
        case "online": return .ok
        case "offline": return .error
        default: return .warning
        }
    }

    private var liveCommandDiagStatus: DiagStatus {
        if liveLastCommand.contains("SUCCESS") { return .ok }
        if liveLastCommand.contains("FAILED") || liveLastCommand.contains("TIMEOUT") { return .error }
        if liveLastCommand == "unknown" || liveLastCommand == "No commands sent yet" { return .warning }
        return .warning
    }
}

import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var wsClient: WebSocketClient
    @State private var devices: [DeviceSnapshot] = []
    @State private var recentLogs: [LogEntry] = []
    @State private var commanding: String?
    @State private var lastCommandState: String = "unknown"
    @State private var lastCommandRequestId: String?
    @State private var lastHeartbeatAt: String?

    private var agentDevice: DeviceSnapshot? { devices.first(where: { $0.role == "agent" }) }
    private var bridgeDevice: DeviceSnapshot? { devices.first(where: { $0.role == "bridge" }) }
    private var agentOnline: Bool { agentDevice?.isOnline ?? false }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    statusSection
                    quickActionsSection
                    activitySection
                }
                .padding()
            }
            .background(GhostycTheme.background)
            .navigationTitle("Dashboard")
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    HStack(spacing: 4) {
                        StatusDot(isOnline: wsClient.connectionState == .connected)
                        Text(connectionLabel)
                            .font(.caption2)
                            .foregroundColor(GhostycTheme.textSecondary)
                    }
                }
            }
        }
        .task { await loadData() }
        .refreshable { await loadData() }
        .onChange(of: wsClient.lastDeviceStatusEvent?.id) { _ in
            guard let event = wsClient.lastDeviceStatusEvent else { return }
            applyDeviceStatus(event)
        }
        .onChange(of: wsClient.lastHeartbeatEvent?.id) { _ in
            guard let event = wsClient.lastHeartbeatEvent else { return }
            if event.role == "agent" {
                lastHeartbeatAt = ISO8601DateFormatter().string(from: event.receivedAt)
            }
        }
        .onChange(of: wsClient.lastCommandResultEvent?.id) { _ in
            guard let event = wsClient.lastCommandResultEvent else { return }
            lastCommandState = event.state
            lastCommandRequestId = event.requestId
            if commanding != nil { commanding = nil }
        }
        .onChange(of: wsClient.lastLogEvent?.id) { _ in
            guard let event = wsClient.lastLogEvent else { return }
            recentLogs.insert(event, at: 0)
            if recentLogs.count > 20 { recentLogs = Array(recentLogs.prefix(20)) }
        }
    }

    // MARK: - Sections

    private var statusSection: some View {
        GhostycCard {
            VStack(alignment: .leading, spacing: 16) {
                Label("System Status", systemImage: "display")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white)

                LazyVGrid(columns: [.init(.flexible()), .init(.flexible())], spacing: 14) {
                    StatusItem(label: "Device", value: agentDevice?.device_id ?? "Not seen", active: agentOnline)
                    StatusItem(label: "Connection", value: agentOnline ? "Connected" : "Disconnected", active: agentOnline)
                    StatusItem(label: "Agent", value: agentDevice != nil ? (agentOnline ? "Running" : "Offline") : "Not seen", active: agentOnline)
                    StatusItem(label: "Relay", value: "Active", active: true)
                    StatusItem(label: "Bridge", value: bridgeDevice?.isOnline == true ? "Ready" : "Not connected")
                    StatusItem(label: "Heartbeat", value: timeAgo(lastHeartbeatAt ?? agentDevice?.last_heartbeat))
                    StatusItem(label: "Version", value: agentDevice?.version ?? "N/A")
                    StatusItem(label: "Last Cmd", value: lastCommandSummary)
                }
            }
        }
    }

    private var quickActionsSection: some View {
        GhostycCard {
            VStack(alignment: .leading, spacing: 14) {
                Label("Quick Actions", systemImage: "bolt.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white)

                LazyVGrid(columns: [.init(.flexible()), .init(.flexible())], spacing: 10) {
                    GhostycButton(title: "Wake PC", icon: "power", isLoading: false) {}
                        .disabled(true)
                        .opacity(0.4)

                    GhostycButton(title: "Sleep", icon: "moon.fill", variant: .outline, isLoading: commanding == "sleep") {
                        sendCommand("sleep")
                    }
                    .disabled(!agentOnline)

                    GhostycButton(title: "Lock", icon: "lock.fill", variant: .outline, isLoading: commanding == "lock") {
                        sendCommand("lock")
                    }
                    .disabled(!agentOnline)

                    GhostycButton(title: "Restart", icon: "arrow.clockwise", variant: .outline, isLoading: commanding == "restart") {
                        sendCommand("restart", args: ["delay_s": 5])
                    }
                    .disabled(!agentOnline)
                }

                GhostycButton(title: "Shutdown", icon: "power", variant: .danger, isLoading: commanding == "shutdown") {
                    sendCommand("shutdown", args: ["delay_s": 10])
                }
                .disabled(!agentOnline)
            }
        }
    }

    private var activitySection: some View {
        GhostycCard {
            VStack(alignment: .leading, spacing: 12) {
                Label("Live Activity", systemImage: "waveform.path.ecg")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white)

                if recentLogs.isEmpty {
                    Text("No log events yet.")
                        .font(.caption)
                        .foregroundColor(GhostycTheme.textTertiary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 20)
                } else {
                    ForEach(recentLogs.prefix(8)) { log in
                        ActivityRow(log: log)
                    }
                }
            }
        }
    }

    // MARK: - Actions

    private func loadData() async {
        do {
            async let devicesReq = APIClient.shared.devices()
            async let logsReq = APIClient.shared.recentLogs(limit: 10)
            let (devResp, logsResp) = try await (devicesReq, logsReq)
            devices = devResp.devices
            recentLogs = logsResp.logs
            if let hb = devResp.devices.first(where: { $0.role == "agent" })?.last_heartbeat {
                lastHeartbeatAt = hb
            }
        } catch {
            // Silently handle — views show "not seen" states
        }
    }

    private func sendCommand(_ command: String, args: [String: Any] = [:]) {
        commanding = command
        Task {
            do {
                _ = try await APIClient.shared.postCommand(command: command, args: args)
            } catch {
                // result arrives via WS
            }
            try? await Task.sleep(nanoseconds: 500_000_000)
            commanding = nil
        }
    }

    private func timeAgo(_ iso: String?) -> String {
        guard let iso = iso, let date = ISO8601DateFormatter().date(from: iso) else { return "N/A" }
        let seconds = Int(Date().timeIntervalSince(date))
        if seconds < 5 { return "just now" }
        if seconds < 60 { return "\(seconds)s ago" }
        if seconds < 3600 { return "\(seconds / 60)m ago" }
        return "\(seconds / 3600)h ago"
    }

    private func applyDeviceStatus(_ event: DeviceStatusEvent) {
        var updated = devices
        if let index = updated.firstIndex(where: { $0.device_id == event.deviceId }) {
            let current = updated[index]
            updated[index] = DeviceSnapshot(
                device_id: current.device_id,
                role: current.role,
                status: event.status,
                last_heartbeat: event.lastHeartbeat ?? current.last_heartbeat,
                connected_since: current.connected_since,
                reconnect_count: event.reconnectCount,
                version: current.version
            )
        } else {
            updated.append(DeviceSnapshot(
                device_id: event.deviceId,
                role: event.role,
                status: event.status,
                last_heartbeat: event.lastHeartbeat,
                connected_since: nil,
                reconnect_count: event.reconnectCount,
                version: nil
            ))
        }
        devices = updated
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

    private var lastCommandSummary: String {
        if let rid = lastCommandRequestId {
            return "\(lastCommandState.uppercased()) (\(rid.prefix(6)))"
        }
        return lastCommandState.uppercased()
    }
}

// MARK: - Subviews

private struct StatusItem: View {
    let label: String
    let value: String
    var active: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .medium))
                .foregroundColor(GhostycTheme.textTertiary)
                .tracking(1)
            HStack(spacing: 6) {
                if active {
                    StatusDot(isOnline: true)
                }
                Text(value)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(GhostycTheme.textPrimary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ActivityRow: View {
    let log: LogEntry

    var body: some View {
        HStack(spacing: 8) {
            Text(formatTime(log.timestamp))
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundColor(GhostycTheme.textTertiary)
                .frame(width: 60, alignment: .leading)

            Text(log.level.uppercased())
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(levelColor(log.level))
                .frame(width: 40, alignment: .leading)

            Text("[\(log.service)] \(log.event)")
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(GhostycTheme.textSecondary)
                .lineLimit(1)
        }
        .padding(.vertical, 4)
    }

    private func formatTime(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: iso) else { return iso.prefix(8).description }
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: date)
    }

    private func levelColor(_ level: String) -> Color {
        switch level {
        case "info": return .blue
        case "warn": return .yellow
        case "error": return .red
        default: return GhostycTheme.textSecondary
        }
    }
}

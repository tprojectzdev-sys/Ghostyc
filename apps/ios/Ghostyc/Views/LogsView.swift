import SwiftUI

struct LogsView: View {
    @EnvironmentObject private var wsClient: WebSocketClient
    @State private var logs: [LogEntry] = []
    @State private var isLoading = true
    @State private var filter = ""
    @State private var serviceFilter = "all"

    private let services = ["all", "relay", "agent", "bridge", "client"]

    private var filtered: [LogEntry] {
        logs.filter { log in
            let matchesService = serviceFilter == "all" || log.service == serviceFilter
            let matchesText = filter.isEmpty ||
                log.message.localizedCaseInsensitiveContains(filter) ||
                log.event.localizedCaseInsensitiveContains(filter) ||
                (log.request_id?.localizedCaseInsensitiveContains(filter) ?? false)
            return matchesService && matchesText
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                VStack(spacing: 10) {
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass")
                            .foregroundColor(GhostycTheme.textTertiary)
                        TextField("Search logs...", text: $filter)
                            .foregroundColor(.white)
                            .font(.system(size: 14))
                    }
                    .padding(10)
                    .background(Color.black.opacity(0.5))
                    .cornerRadius(10)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.1), lineWidth: 1))

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(services, id: \.self) { svc in
                                Button(action: { serviceFilter = svc }) {
                                    Text(svc == "all" ? "All Services" : svc.capitalized)
                                        .font(.system(size: 11, weight: .semibold))
                                        .foregroundColor(serviceFilter == svc ? .white : GhostycTheme.textTertiary)
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 5)
                                        .background(serviceFilter == svc ? Color.white.opacity(0.1) : Color.clear)
                                        .cornerRadius(20)
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 20)
                                                .stroke(serviceFilter == svc ? Color.white.opacity(0.2) : Color.white.opacity(0.05), lineWidth: 1)
                                        )
                                }
                            }
                        }
                    }

                    HStack(spacing: 6) {
                        Circle()
                            .fill(connectionColor)
                            .frame(width: 6, height: 6)
                        Text("WebSocket: \(connectionLabel)")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundColor(GhostycTheme.textTertiary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding()
                .background(Color.black.opacity(0.3))

                if isLoading {
                    ProgressView().tint(.white)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if filtered.isEmpty {
                    Text("No logs matching the current filter.")
                        .font(.caption)
                        .foregroundColor(GhostycTheme.textTertiary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 2) {
                            ForEach(filtered) { log in
                                LogRow(log: log)
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                    }
                    .background(Color.black.opacity(0.4))
                }
            }
            .background(GhostycTheme.background)
            .navigationTitle("Logs")
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { Task { await loadLogs() } }) {
                        Image(systemName: "arrow.clockwise")
                            .foregroundColor(.white)
                    }
                }
            }
        }
        .task { await loadLogs() }
        .refreshable { await loadLogs() }
        .onChange(of: wsClient.lastLogEvent?.id) { _ in
            guard let event = wsClient.lastLogEvent else { return }
            logs.insert(event, at: 0)
            if logs.count > 500 {
                logs = Array(logs.prefix(500))
            }
        }
    }

    private func loadLogs() async {
        isLoading = true
        do {
            let response = try await APIClient.shared.recentLogs(limit: 200)
            logs = response.logs
        } catch {
            // keep stale
        }
        isLoading = false
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

    private var connectionColor: Color {
        switch wsClient.connectionState {
        case .connected: return .white
        case .connecting, .reconnecting: return .yellow
        case .disconnected, .failed: return .gray
        }
    }
}

private struct LogRow: View {
    let log: LogEntry

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text(formatTime(log.timestamp))
                .font(.system(size: 9, design: .monospaced))
                .foregroundColor(GhostycTheme.textTertiary)
                .frame(width: 55, alignment: .leading)

            Text(log.level.uppercased())
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundColor(levelColor(log.level))
                .frame(width: 35, alignment: .leading)

            VStack(alignment: .leading, spacing: 2) {
                Text("[\(log.service)] \(log.event)")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundColor(GhostycTheme.textSecondary)
                    .lineLimit(1)

                Text(log.message)
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundColor(GhostycTheme.textSecondary.opacity(0.7))
                    .lineLimit(2)
            }

            Spacer()

            if let rid = log.request_id {
                Text(rid.prefix(6))
                    .font(.system(size: 8, design: .monospaced))
                    .foregroundColor(Color(white: 0.25))
            }
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 4)
    }

    private func formatTime(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: iso) else { return "" }
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

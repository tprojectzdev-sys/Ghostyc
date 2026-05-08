import SwiftUI

struct CommandsView: View {
    @State private var commands: [CommandRow] = []
    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView()
                        .tint(.white)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if commands.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "terminal")
                            .font(.system(size: 32))
                            .foregroundColor(GhostycTheme.textTertiary)
                        Text("No commands executed yet.")
                            .font(.caption)
                            .foregroundColor(GhostycTheme.textTertiary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(commands) { cmd in
                        CommandRowView(cmd: cmd)
                            .listRowBackground(Color.clear)
                            .listRowSeparatorTint(Color.white.opacity(0.05))
                    }
                    .listStyle(.plain)
                }
            }
            .background(GhostycTheme.background)
            .navigationTitle("Commands")
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { Task { await loadCommands() } }) {
                        Image(systemName: "arrow.clockwise")
                            .foregroundColor(.white)
                    }
                }
            }
        }
        .task { await loadCommands() }
        .refreshable { await loadCommands() }
    }

    private func loadCommands() async {
        isLoading = true
        do {
            let response = try await APIClient.shared.recentLogs(limit: 200, service: "relay")
            var cmdMap: [String: CommandRow] = [:]
            for log in response.logs {
                guard let rid = log.request_id, let cmd = log.command else { continue }
                if cmdMap[rid] == nil {
                    cmdMap[rid] = CommandRow(
                        request_id: rid,
                        time: formatTime(log.timestamp),
                        command: cmd,
                        state: "accepted",
                        duration: "---",
                        error: nil
                    )
                }
                if log.event == "command.result" || log.event == "command.timeout" {
                    cmdMap[rid]?.state = log.status ?? "unknown"
                    if let ms = log.duration_ms { cmdMap[rid]?.duration = "\(Int(ms))ms" }
                    cmdMap[rid]?.error = log.error?.message
                }
            }
            commands = Array(cmdMap.values).reversed()
        } catch {
            // keep stale data
        }
        isLoading = false
    }

    private func formatTime(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: iso) else { return iso }
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: date)
    }
}

struct CommandRow: Identifiable {
    let request_id: String
    let time: String
    let command: String
    var state: String
    var duration: String
    var error: String?

    var id: String { request_id }
}

private struct CommandRowView: View {
    let cmd: CommandRow

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(cmd.command)
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .foregroundColor(.white)

                Spacer()

                StateBadge(state: cmd.state)
            }

            HStack(spacing: 16) {
                Label(cmd.time, systemImage: "clock")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(GhostycTheme.textTertiary)

                Text(cmd.request_id.prefix(8))
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(GhostycTheme.textTertiary)

                Text(cmd.duration)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(GhostycTheme.textTertiary)
            }

            if let error = cmd.error {
                Text(error)
                    .font(.system(size: 11))
                    .foregroundColor(GhostycTheme.textSecondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct StateBadge: View {
    let state: String

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(stateColor)
                .frame(width: 5, height: 5)
            Text(state)
                .font(.system(size: 10, weight: .semibold))
        }
        .foregroundColor(stateColor)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(stateColor.opacity(0.1))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(stateColor.opacity(0.3), lineWidth: 1))
        .cornerRadius(20)
    }

    private var stateColor: Color {
        switch state {
        case "success": return .white
        case "failed": return Color(white: 0.5)
        case "timeout": return .yellow.opacity(0.7)
        case "running", "accepted": return .blue.opacity(0.7)
        default: return GhostycTheme.textTertiary
        }
    }
}

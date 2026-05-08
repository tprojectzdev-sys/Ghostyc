import SwiftUI

struct ProcessEntry: Identifiable {
    let pid: Int
    let name: String
    let mem_mb: Double
    let cpu_percent: Double?

    var id: Int { pid }
}

struct ProcessesView: View {
    @State private var processes: [ProcessEntry] = []
    @State private var filter = ""
    @State private var isLoading = false
    @State private var hasLoaded = false
    @State private var killing: Int?
    @State private var error: String?

    private var filtered: [ProcessEntry] {
        if filter.isEmpty { return processes }
        return processes.filter { $0.name.localizedCaseInsensitiveContains(filter) }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass")
                            .foregroundColor(GhostycTheme.textTertiary)
                        TextField("Search processes...", text: $filter)
                            .foregroundColor(.white)
                            .font(.system(size: 14))
                    }
                    .padding(10)
                    .background(Color.black.opacity(0.5))
                    .cornerRadius(10)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.1), lineWidth: 1))

                    Button(action: { Task { await fetchProcesses() } }) {
                        Group {
                            if isLoading {
                                ProgressView().tint(.white).scaleEffect(0.8)
                            } else {
                                Image(systemName: "arrow.clockwise")
                            }
                        }
                        .frame(width: 40, height: 40)
                        .background(Color.white.opacity(0.05))
                        .cornerRadius(10)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.1), lineWidth: 1))
                    }
                    .foregroundColor(.white)
                }
                .padding()

                if let error = error {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(GhostycTheme.textSecondary)
                        .padding(.horizontal)
                }

                if !hasLoaded && !isLoading {
                    VStack(spacing: 12) {
                        Image(systemName: "chart.bar.fill")
                            .font(.system(size: 32))
                            .foregroundColor(GhostycTheme.textTertiary)
                        Text("Tap refresh to load the process list.")
                            .font(.caption)
                            .foregroundColor(GhostycTheme.textTertiary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(filtered) { proc in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(proc.name)
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundColor(.white)
                                HStack(spacing: 12) {
                                    Text("PID \(proc.pid)")
                                        .font(.system(size: 11, design: .monospaced))
                                        .foregroundColor(GhostycTheme.textTertiary)
                                    Text(formatMem(proc.mem_mb))
                                        .font(.system(size: 11, design: .monospaced))
                                        .foregroundColor(GhostycTheme.textSecondary)
                                }
                            }
                            Spacer()
                            Button(action: { killProcess(proc.pid) }) {
                                if killing == proc.pid {
                                    ProgressView().tint(.white).scaleEffect(0.7)
                                } else {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 12))
                                        .foregroundColor(GhostycTheme.textTertiary)
                                }
                            }
                            .frame(width: 32, height: 32)
                            .disabled(killing != nil)
                        }
                        .padding(.vertical, 4)
                        .listRowBackground(Color.clear)
                        .listRowSeparatorTint(Color.white.opacity(0.05))
                    }
                    .listStyle(.plain)
                }
            }
            .background(GhostycTheme.background)
            .navigationTitle("Processes")
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }

    private func formatMem(_ mb: Double) -> String {
        mb >= 1024 ? String(format: "%.1f GB", mb / 1024) : "\(Int(mb)) MB"
    }

    private func fetchProcesses() async {
        isLoading = true
        error = nil
        do {
            let res = try await APIClient.shared.postCommand(command: "list_processes", args: ["limit": 200, "sort": "mem"])
            let rid = res.request_id
            try await Task.sleep(nanoseconds: 800_000_000)
            for _ in 0..<20 {
                let cmd = try await APIClient.shared.getCommand(requestId: rid)
                if cmd.state == "success", let result = cmd.result?.value as? [String: Any],
                   let procs = result["processes"] as? [[String: Any]] {
                    processes = procs.compactMap { dict in
                        guard let pid = dict["pid"] as? Int,
                              let name = dict["name"] as? String,
                              let mem = dict["mem_mb"] as? Double else { return nil }
                        return ProcessEntry(pid: pid, name: name, mem_mb: mem, cpu_percent: dict["cpu_percent"] as? Double)
                    }
                    hasLoaded = true
                    isLoading = false
                    return
                }
                if cmd.state == "failed" || cmd.state == "timeout" {
                    error = cmd.error?.message ?? "Command \(cmd.state)"
                    isLoading = false
                    return
                }
                try await Task.sleep(nanoseconds: 500_000_000)
            }
            error = "Timed out waiting for process list"
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    private func killProcess(_ pid: Int) {
        killing = pid
        Task {
            do {
                _ = try await APIClient.shared.postCommand(command: "kill_process", args: ["pid": pid])
                try await Task.sleep(nanoseconds: 1_500_000_000)
                await fetchProcesses()
            } catch {
                // ignore
            }
            killing = nil
        }
    }
}

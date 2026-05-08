import SwiftUI

struct ControlView: View {
    @State private var appName = ""
    @State private var websiteURL = ""
    @State private var appPath = ""
    @State private var sending: String?
    @State private var lastResult: String?
    @State private var lastError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    GhostycCard {
                        VStack(alignment: .leading, spacing: 14) {
                            Label("Launch App", systemImage: "square.grid.2x2.fill")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundColor(.white)

                            Text("APP NAME")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundColor(GhostycTheme.textTertiary)
                                .tracking(1)

                            HStack(spacing: 8) {
                                TextField("e.g. spotify, discord, calc", text: $appName)
                                    .textFieldStyle(GhostycTextField())

                                Button(action: { sendOpenApp() }) {
                                    Image(systemName: sending == "open_app_name" ? "hourglass" : "paperplane.fill")
                                        .frame(width: 40, height: 40)
                                        .background(Color.white.opacity(0.1))
                                        .cornerRadius(10)
                                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.2), lineWidth: 1))
                                }
                                .disabled(appName.isEmpty || sending != nil)
                                .foregroundColor(.white)
                            }
                        }
                    }

                    GhostycCard {
                        VStack(alignment: .leading, spacing: 14) {
                            Label("Open Website", systemImage: "globe")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundColor(.white)

                            Text("URL")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundColor(GhostycTheme.textTertiary)
                                .tracking(1)

                            HStack(spacing: 8) {
                                TextField("https://...", text: $websiteURL)
                                    .textFieldStyle(GhostycTextField())
                                    .autocapitalization(.none)
                                    .keyboardType(.URL)

                                Button(action: { sendOpenWebsite() }) {
                                    Image(systemName: sending == "open_website" ? "hourglass" : "paperplane.fill")
                                        .frame(width: 40, height: 40)
                                        .background(Color.white.opacity(0.1))
                                        .cornerRadius(10)
                                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.2), lineWidth: 1))
                                }
                                .disabled(websiteURL.isEmpty || sending != nil)
                                .foregroundColor(.white)
                            }
                        }
                    }

                    GhostycCard {
                        VStack(alignment: .leading, spacing: 14) {
                            Label("Launch by Path", systemImage: "folder.fill")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundColor(.white)

                            TextField("C:\\Program Files\\App\\app.exe", text: $appPath)
                                .textFieldStyle(GhostycTextField())
                                .font(.system(size: 13, design: .monospaced))

                            GhostycButton(title: "Launch", icon: "play.fill", isLoading: sending == "open_app_path") {
                                sendOpenAppByPath()
                            }
                            .disabled(appPath.isEmpty || sending != nil)

                            if let result = lastResult {
                                resultBanner(text: result, isError: false)
                            }
                            if let error = lastError {
                                resultBanner(text: error, isError: true)
                            }
                        }
                    }
                }
                .padding()
            }
            .background(GhostycTheme.background)
            .navigationTitle("Control")
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }

    private func resultBanner(text: String, isError: Bool) -> some View {
        Text(text)
            .font(.system(size: 11, design: .monospaced))
            .foregroundColor(isError ? GhostycTheme.textSecondary : GhostycTheme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(Color.black.opacity(0.5))
            .cornerRadius(8)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.white.opacity(0.05), lineWidth: 1))
    }

    private func sendOpenApp() {
        guard !appName.isEmpty else { return }
        sending = "open_app_name"
        lastResult = nil; lastError = nil
        Task {
            do {
                let res = try await APIClient.shared.postCommand(command: "open_app", args: ["name": appName])
                lastResult = "Accepted: \(res.request_id.prefix(8))"
                appName = ""
            } catch {
                lastError = error.localizedDescription
            }
            sending = nil
        }
    }

    private func sendOpenWebsite() {
        guard !websiteURL.isEmpty else { return }
        sending = "open_website"
        lastResult = nil; lastError = nil
        Task {
            do {
                let res = try await APIClient.shared.postCommand(command: "open_website", args: ["url": websiteURL])
                lastResult = "Accepted: \(res.request_id.prefix(8))"
                websiteURL = ""
            } catch {
                lastError = error.localizedDescription
            }
            sending = nil
        }
    }

    private func sendOpenAppByPath() {
        guard !appPath.isEmpty else { return }
        sending = "open_app_path"
        lastResult = nil; lastError = nil
        Task {
            do {
                let res = try await APIClient.shared.postCommand(command: "open_app", args: ["path": appPath])
                lastResult = "Accepted: \(res.request_id.prefix(8))"
                appPath = ""
            } catch {
                lastError = error.localizedDescription
            }
            sending = nil
        }
    }
}

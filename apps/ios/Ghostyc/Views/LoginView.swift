import SwiftUI

struct LoginView: View {
    @EnvironmentObject var authManager: AuthManager
    @State private var password = ""
    @State private var relayURL = UserDefaults.standard.string(forKey: "relay_url") ?? ""
    @State private var isLoading = false

    var body: some View {
        ZStack {
            GhostycTheme.background.ignoresSafeArea()

            VStack(spacing: 32) {
                Spacer()

                VStack(spacing: 12) {
                    Image(systemName: "ghost.fill")
                        .font(.system(size: 40))
                        .foregroundColor(.white.opacity(0.6))

                    Text("Ghostyc")
                        .font(.title2)
                        .fontWeight(.semibold)
                        .foregroundColor(.white)

                    Text("Private PC control ecosystem")
                        .font(.caption)
                        .foregroundColor(GhostycTheme.textTertiary)
                }

                VStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("RELAY URL")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundColor(GhostycTheme.textTertiary)
                            .tracking(1)

                        TextField("https://your-relay.railway.app", text: $relayURL)
                            .textFieldStyle(GhostycTextField())
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                            .keyboardType(.URL)
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("PASSWORD")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundColor(GhostycTheme.textTertiary)
                            .tracking(1)

                        SecureField("Enter admin password", text: $password)
                            .textFieldStyle(GhostycTextField())
                    }
                }
                .padding(.horizontal, 32)

                if let error = authManager.error {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(GhostycTheme.textSecondary)
                        .padding(.horizontal, 32)
                        .padding(.vertical, 12)
                        .background(Color.white.opacity(0.05))
                        .cornerRadius(10)
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .stroke(Color.white.opacity(0.1), lineWidth: 1)
                        )
                        .padding(.horizontal, 32)
                }

                Button(action: {
                    isLoading = true
                    Task {
                        await authManager.login(password: password, relayURL: relayURL)
                        isLoading = false
                    }
                }) {
                    HStack(spacing: 8) {
                        if isLoading {
                            ProgressView().tint(.white).scaleEffect(0.8)
                        }
                        Text(isLoading ? "Authenticating..." : "Sign In")
                            .font(.system(size: 14, weight: .medium))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Color.white.opacity(0.1))
                    .foregroundColor(.white)
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(Color.white.opacity(0.2), lineWidth: 1)
                    )
                    .cornerRadius(10)
                }
                .disabled(password.isEmpty || relayURL.isEmpty || isLoading)
                .opacity(password.isEmpty || relayURL.isEmpty ? 0.5 : 1)
                .padding(.horizontal, 32)

                Spacer()
                Spacer()
            }
        }
    }
}

struct GhostycTextField: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(Color.black.opacity(0.5))
            .foregroundColor(.white)
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color.white.opacity(0.1), lineWidth: 1)
            )
            .cornerRadius(10)
            .font(.system(size: 14))
    }
}

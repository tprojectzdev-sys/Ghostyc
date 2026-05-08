import Foundation
import SwiftUI

@MainActor
class AuthManager: ObservableObject {
    @Published var isAuthenticated = false
    @Published var isLoading = true
    @Published var error: String?

    init() {
        Task { await checkExistingToken() }
    }

    private func checkExistingToken() async {
        guard KeychainHelper.load(key: "ghostyc_token") != nil else {
            isLoading = false
            return
        }
        do {
            _ = try await APIClient.shared.whoami()
            isAuthenticated = true
        } catch {
            KeychainHelper.delete(key: "ghostyc_token")
        }
        isLoading = false
    }

    func login(password: String, relayURL: String) async {
        error = nil
        let trimmedURL = relayURL.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        UserDefaults.standard.set(trimmedURL, forKey: "relay_url")

        do {
            let response = try await APIClient.shared.login(password: password)
            KeychainHelper.save(key: "ghostyc_token", value: response.token)
            isAuthenticated = true
            WebSocketClient.shared.connect()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func logout() {
        KeychainHelper.delete(key: "ghostyc_token")
        WebSocketClient.shared.disconnect()
        isAuthenticated = false
    }
}

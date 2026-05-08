import Foundation

enum APIError: LocalizedError {
    case invalidURL
    case unauthorized
    case serverError(code: String, message: String)
    case networkError(Error)
    case decodingError(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid URL"
        case .unauthorized: return "Unauthorized"
        case .serverError(_, let message): return message
        case .networkError(let error): return error.localizedDescription
        case .decodingError(let error): return "Decode error: \(error.localizedDescription)"
        }
    }
}

actor APIClient {
    static let shared = APIClient()

    private var baseURL: String {
        UserDefaults.standard.string(forKey: "relay_url") ?? "http://localhost:8080"
    }

    private var token: String? {
        KeychainHelper.load(key: "ghostyc_token")
    }

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        return d
    }()

    private func makeRequest(_ path: String, method: String = "GET", body: Data? = nil) throws -> URLRequest {
        guard let url = URL(string: "\(baseURL)\(path)") else { throw APIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = body
        request.timeoutInterval = 15
        return request
    }

    private func perform<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw APIError.networkError(error)
        }

        if let httpResponse = response as? HTTPURLResponse {
            if httpResponse.statusCode == 401 {
                throw APIError.unauthorized
            }
            if httpResponse.statusCode >= 400 {
                if let errorBody = try? JSONDecoder().decode(ServerErrorBody.self, from: data) {
                    throw APIError.serverError(code: errorBody.error?.code ?? "unknown", message: errorBody.error?.message ?? "Server error")
                }
                throw APIError.serverError(code: "http_\(httpResponse.statusCode)", message: "HTTP \(httpResponse.statusCode)")
            }
        }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    // MARK: - Public API

    func login(password: String) async throws -> LoginResponse {
        let body = try JSONEncoder().encode(LoginRequest(password: password))
        let request = try makeRequest("/auth/login", method: "POST", body: body)
        return try await perform(request)
    }

    func whoami() async throws -> WhoamiResponse {
        let request = try makeRequest("/auth/whoami")
        return try await perform(request)
    }

    func health() async throws -> HealthResponse {
        let request = try makeRequest("/health")
        return try await perform(request)
    }

    func devices() async throws -> DevicesResponse {
        let request = try makeRequest("/devices")
        return try await perform(request)
    }

    func postCommand(target: String = "agent", command: String, args: [String: Any] = [:], timeout_ms: Int? = nil) async throws -> CommandAccepted {
        let payload = PostCommandRequest(
            target: target,
            command: command,
            args: args.mapValues { AnyCodable($0) },
            timeout_ms: timeout_ms
        )
        let body = try JSONEncoder().encode(payload)
        let request = try makeRequest("/commands", method: "POST", body: body)
        return try await perform(request)
    }

    func getCommand(requestId: String) async throws -> CommandRecord {
        let request = try makeRequest("/commands/\(requestId)")
        return try await perform(request)
    }

    func recentLogs(limit: Int = 100, service: String? = nil) async throws -> LogsResponse {
        var path = "/logs/recent?limit=\(limit)"
        if let service = service { path += "&service=\(service)" }
        let request = try makeRequest(path)
        return try await perform(request)
    }

    func diagnostics() async throws -> DiagnosticsSnapshot {
        let request = try makeRequest("/diagnostics")
        return try await perform(request)
    }
}

private struct ServerErrorBody: Decodable {
    let error: ServerErrorDetail?
}

private struct ServerErrorDetail: Decodable {
    let code: String?
    let message: String?
}

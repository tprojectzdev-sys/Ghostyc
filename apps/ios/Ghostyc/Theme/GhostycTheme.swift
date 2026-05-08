import SwiftUI

enum GhostycTheme {
    static let background = Color.black
    static let cardBackground = Color(white: 0.067).opacity(0.8)
    static let cardBorder = Color.white.opacity(0.1)
    static let textPrimary = Color.white
    static let textSecondary = Color(white: 0.6)
    static let textTertiary = Color(white: 0.4)
    static let accentGlow = Color.white.opacity(0.15)
    static let success = Color.white
    static let warning = Color(white: 0.5)
    static let error = Color(white: 0.35)
}

struct GhostycCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding()
            .background(GhostycTheme.cardBackground)
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(GhostycTheme.cardBorder, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

struct GhostycButton: View {
    let title: String
    let icon: String
    var variant: Variant = .default
    var isLoading: Bool = false
    let action: () -> Void

    enum Variant {
        case `default`, outline, danger
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if isLoading {
                    ProgressView()
                        .tint(.white)
                        .scaleEffect(0.8)
                } else {
                    Image(systemName: icon)
                        .font(.system(size: 14, weight: .medium))
                }
                Text(title)
                    .font(.system(size: 14, weight: .medium))
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(backgroundStyle)
            .foregroundColor(foregroundStyle)
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(borderStyle, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .disabled(isLoading)
    }

    private var backgroundStyle: Color {
        switch variant {
        case .default: return .white.opacity(0.1)
        case .outline: return .clear
        case .danger: return .clear
        }
    }

    private var foregroundStyle: Color {
        switch variant {
        case .default: return .white
        case .outline: return .white
        case .danger: return Color(white: 0.7)
        }
    }

    private var borderStyle: Color {
        switch variant {
        case .default: return .white.opacity(0.2)
        case .outline: return .white.opacity(0.1)
        case .danger: return .white.opacity(0.1)
        }
    }
}

struct StatusDot: View {
    let isOnline: Bool

    var body: some View {
        Circle()
            .fill(isOnline ? Color.white : Color(white: 0.3))
            .frame(width: 6, height: 6)
            .shadow(color: isOnline ? .white.opacity(0.5) : .clear, radius: 4)
    }
}

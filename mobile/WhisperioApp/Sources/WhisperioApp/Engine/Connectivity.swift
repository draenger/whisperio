import Foundation
import Network

// Real network reachability, backing the Home offline banner (mob-single.jsx "Offline ·
// feature" scene / mob-screens.jsx EdgeStates StateHome banner). NWPathMonitor is the only
// source of truth here — no simulated/forced states.
@MainActor
final class Connectivity: ObservableObject {
    static let shared = Connectivity()

    @Published private(set) var isOnline = true

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "whisperio.connectivity")

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let satisfied = path.status == .satisfied
            Task { @MainActor in
                self?.isOnline = satisfied
            }
        }
        monitor.start(queue: queue)
    }
}

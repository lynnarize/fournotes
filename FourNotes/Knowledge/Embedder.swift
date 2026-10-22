import Foundation
@preconcurrency import NaturalLanguage

// Text as vectors, on this Mac: Apple's contextual embedding model for Latin script,
// which covers English, Indonesian and eighteen more languages with one model (512
// numbers a piece, 256 tokens at most). It comes with macOS, or is downloaded by macOS
// on first use; nothing is sent anywhere. Each token's vector is averaged into one for
// the whole piece.
//
// It isn't trained to compare meanings, so on its own it ranks loosely: a paraphrase
// with no word in common is found more often than not, never reliably, and a question
// in one language doesn't find text in the other. Search leans on keywords and uses
// this to reorder and to catch the near misses (see HybridRanking).

actor Embedder {
    static let shared = Embedder()

    enum State: Equatable, Sendable {
        case unknown, preparing, ready, unavailable(String)
    }

    private(set) var state: State = .unknown
    private var model: NLContextualEmbedding?
    private var preparing: Task<Bool, Never>?

    /// The model and its revision, stored with every vector so a new model's vectors
    /// aren't compared with an old one's.
    private(set) var identifier = ""
    private(set) var dimension = 0

    /// Loads the model, asking macOS for it first if it isn't on this Mac yet. False
    /// when it can't be had; search then works on keywords alone.
    func prepare() async -> Bool {
        if state == .ready { return true }
        if case .unavailable = state { return false }
        if let preparing { return await preparing.value }
        state = .preparing
        let task = Task { await self.load() }
        preparing = task
        let ok = await task.value
        preparing = nil
        return ok
    }

    private func load() async -> Bool {
        guard let model = NLContextualEmbedding(script: .latin) else {
            state = .unavailable("This Mac has no embedding model for Latin script.")
            return false
        }
        if !model.hasAvailableAssets {
            let result = await withCheckedContinuation { (done: CheckedContinuation<NLContextualEmbedding.AssetsResult, Never>) in
                model.requestAssets { result, _ in done.resume(returning: result) }
            }
            guard result == .available else {
                state = .unavailable("macOS couldn't download its embedding model. Search uses keywords until it can.")
                return false
            }
        }
        do {
            try model.load()
        } catch {
            state = .unavailable("The embedding model couldn't be loaded. Search uses keywords instead.")
            return false
        }
        self.model = model
        identifier = "\(model.modelIdentifier)#\(model.revision)"
        dimension = model.dimension
        state = .ready
        return true
    }

    /// One normalized vector per text, nil for a text with nothing in it (or with no model).
    func vectors(_ texts: [String]) -> [[Float]?] {
        texts.map { vector($0) }
    }

    func vector(_ text: String) -> [Float]? {
        guard let model else { return nil }
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return nil }
        let recognizer = NLLanguageRecognizer()
        recognizer.processString(String(clean.prefix(400)))
        let language = recognizer.dominantLanguage.flatMap { model.languages.contains($0) ? $0 : nil }
        guard let result = try? model.embeddingResult(for: clean, language: language) else { return nil }
        var sum = [Double](repeating: 0, count: model.dimension)
        var count = 0
        result.enumerateTokenVectors(in: clean.startIndex..<clean.endIndex) { vector, _ in
            for i in 0..<min(vector.count, sum.count) { sum[i] += vector[i] }
            count += 1
            return true
        }
        guard count > 0 else { return nil }
        return VectorMath.normalized(sum.map { Float($0 / Double(count)) })
    }
}

enum VectorMath {
    static func normalized(_ v: [Float]) -> [Float] {
        let length = sqrt(v.reduce(0) { $0 + $1 * $1 })
        return length > 0 ? v.map { $0 / length } : v
    }

    static func dot(_ a: [Float], _ b: [Float]) -> Float {
        var s: Float = 0
        for i in 0..<min(a.count, b.count) { s += a[i] * b[i] }
        return s
    }

    /// The average of many vectors. Every vector from this model points much the same
    /// way, so similarities bunch up near 0.8; taking the average away first spreads
    /// them out and is what makes them worth comparing.
    static func mean(_ vectors: [[Float]], dimension: Int) -> [Float] {
        guard !vectors.isEmpty else { return [Float](repeating: 0, count: dimension) }
        var sum = [Float](repeating: 0, count: dimension)
        for v in vectors where v.count == dimension { for i in 0..<dimension { sum[i] += v[i] } }
        return sum.map { $0 / Float(vectors.count) }
    }

    static func centered(_ v: [Float], _ mean: [Float]) -> [Float] {
        guard v.count == mean.count else { return v }
        return normalized(zip(v, mean).map { $0 - $1 })
    }
}

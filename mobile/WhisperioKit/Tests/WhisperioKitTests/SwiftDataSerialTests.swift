import Testing

/// Parent suite for every test that creates SwiftData `@Model` objects or a `ModelContainer`.
///
/// Swift Testing runs suites in parallel and `.serialized` only orders tests inside one suite.
/// SwiftData is not safe to exercise from several suites at once in the same process (an
/// intermittent signal 11 in swiftpm-testing-helper, about 1 in 22 runs, at
/// `ConversationPersistenceTests.plainDictationKeepsNilBlobsThroughTheEntity`). Nesting those
/// suites here makes the trait apply to all of them together; the rest of the package stays parallel.
@Suite(.serialized) struct SwiftDataSerialTests {}

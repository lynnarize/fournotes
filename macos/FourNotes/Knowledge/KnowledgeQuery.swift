import Foundation

// What a question asks for, as search reads it: the words worth matching, in English or
// Indonesian, and the stretch of time it names ("last month's calls", "rapat kemarin"),
// so "what did we decide about pricing in last month's calls?" looks at last month's.

enum KnowledgeQuery {
    private static let stop: Set<String> = Set((
        "the and for with that this from have has had was were are you your not but all can could will would just into our out "
        + "about what when where who whom how why which did does doing done say said says tell told also any some more most "
        + "there their they them then than yes okay ok please me my mine we us its it's i'm i've get got give gave make made "
        + "know let like want need should shall may might must here been being his her him she he one two again ever every "
        + "last this next week weeks month months year years day days today yesterday tomorrow ago recent recently "
        + "call calls meeting meetings talk talks conversation conversations recorded "
        + "yang dan untuk dengan ini itu dari ada akan bisa juga sudah belum tidak atau karena pada saya aku kamu kita kami "
        + "apa siapa kapan bilang mana bagaimana gimana kenapa mengapa tentang soal dalam lalu kemarin besok minggu bulan tahun hari"
    ).split(separator: " ").map(String.init))

    /// The words worth matching: two letters or more, three without a digit ("q3" counts,
    /// "we" doesn't), and none of the words every question has.
    static func terms(_ text: String) -> [String] {
        Search.tokenize(text).filter { word in
            !stop.contains(word) && (word.count >= 3 || (word.count == 2 && word.contains(where: \.isNumber)))
        }
    }

    /// Asks about calls or meetings rather than notes or files.
    static func aboutTalks(_ text: String) -> Bool {
        text.range(of: #"\b(calls?|meetings?|talks?|conversations?|standups?|interviews?|syncs?|1:1s?|one-on-ones?|rapat|meeting|telepon|obrolan|percakapan|diskusi)\b"#,
                   options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// The stretch of time a question names, or nil.
    static func range(in text: String, now: Date = Date(), calendar: Calendar = .current) -> DateInterval? {
        let t = text.lowercased()
        func has(_ pattern: String) -> Bool { t.range(of: pattern, options: .regularExpression) != nil }
        let today = calendar.startOfDay(for: now)
        func days(_ from: Int, _ to: Int) -> DateInterval? {
            guard let start = calendar.date(byAdding: .day, value: from, to: today),
                  let end = calendar.date(byAdding: .day, value: to, to: today) else { return nil }
            return DateInterval(start: start, end: end)
        }
        func unit(_ component: Calendar.Component, back: Int) -> DateInterval? {
            guard let shifted = calendar.date(byAdding: component, value: -back, to: now) else { return nil }
            return calendar.dateInterval(of: component, for: shifted)
        }

        if has(#"\btoday\b|\bhari ini\b|\bthis morning\b|\btadi\b"#) { return days(0, 1) }
        if has(#"\byesterday\b|\bkemarin\b"#) { return days(-1, 0) }
        if let m = t.firstMatch(of: /(?:last|past|previous)\s+(\d{1,3})\s+days?|(\d{1,3})\s+hari\s+(?:terakhir|lalu)/),
           let n = Int(m.1 ?? m.2 ?? "") {
            return days(-n, 1)
        }
        if has(#"\blast week\b|\bminggu lalu\b|\bpekan lalu\b"#) { return unit(.weekOfYear, back: 1) }
        if has(#"\bthis week\b|\bminggu ini\b|\bpekan ini\b"#) { return unit(.weekOfYear, back: 0) }
        if has(#"\blast month\b|\bbulan lalu\b"#) { return unit(.month, back: 1) }
        if has(#"\bthis month\b|\bbulan ini\b"#) { return unit(.month, back: 0) }
        if has(#"\blast year\b|\btahun lalu\b"#) { return unit(.year, back: 1) }

        // "in March", "bulan Maret": that month, this year or the last one if it's still to come.
        let months: [(Int, String)] = [
            (1, "january|januari"), (2, "february|februari"), (3, "march|maret"), (4, "april"), (5, "may|mei"),
            (6, "june|juni"), (7, "july|juli"), (8, "august|agustus"), (9, "september"), (10, "october|oktober"),
            (11, "november|nopember"), (12, "december|desember"),
        ]
        for (month, names) in months where has(#"\b(in|on|during|from|bulan|pada|di)\s+("# + names + #")\b"#) {
            var components = calendar.dateComponents([.year], from: now)
            components.month = month
            components.day = 1
            guard var start = calendar.date(from: components) else { continue }
            if start > now, let earlier = calendar.date(byAdding: .year, value: -1, to: start) { start = earlier }
            return calendar.dateInterval(of: .month, for: start)
        }
        return nil
    }
}

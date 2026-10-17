# Android privacy policy - review notes

Files changed: `docs/privacy.html` (Last updated -> October 17, 2026), `docs/terms.html` (one sentence in the intro, line 71, which lists platforms). Binding source: `docs/android/CONTRACT.md`.

## 1. Claim -> contract backing

| Claim in privacy.html | Where | Contract |
|---|---|---|
| Android 1.0.0 has no on-device recognition, no system SpeechRecognizer | 4.1 | §2 Out of v1 |
| Android providers: OpenAI, Groq, Mistral, ElevenLabs, Deepgram, AssemblyAI, self-hosted; no Replicate | 4.1 | §2, §4.1 |
| Vocabulary sent with audio (prompt / keyterms) | 4.1, 8.1 | §4.1 table, §8.1 |
| Official providers HTTPS only; plain HTTP only for private-network custom URLs; no redirects from HTTP address | 4.1, 8.1 | §4.3 (two clients, followRedirects(false)), §8.1 "Encrypted in transit" |
| Nothing uploaded before in-app consent | 4.1, 8.1 | §4.2 consent gate, §7.1 step 2 |
| No AI cleanup/summaries, only local rule-based tidy | 4.2 | §2 Out of v1, §7.4 deterministic cleanup |
| No GitHub sync, no iCloud/cloud sync on Android | 4.3, 5, 8.4 | §2 Out of v1 |
| No update check in the app (updates via Google Play) | 6 | §8 complete network destination list |
| Permissions: microphone + internet only; no storage/notification/foreground-service | 7, 8.5 | §8 Permissions, §6 (no foreground service) |
| Audio recorded only on user tap (keyboard, tile, shortcut, app); no background recording | 8.1 | §5, §6 |
| Leaving screen / hiding keyboard stops recording | 8.1 | §5 (focus lost -> stop and discard), §6 (leaving the activity stops) |
| Network destinations only configured providers + custom URL; no Whisperio server/analytics/crash/ads/Play Services/Firebase | 8.1 | §8 |
| Free, no purchases | 8.1 | header, §10 |
| Keys: AES-256-GCM, Android Keystore, non-exportable, ciphertext in private store | 3, 8.2 | §7.2 |
| Keys not backed up / not transferred (allowBackup=false + data-extraction rules) | 8.2 | §3 Release, §7.2 |
| Invalidated key -> ciphertext wiped, user re-enters; keys not logged | 8.2 | §7.2 |
| Keyboard never reads/stores typed text | 8.3 | §5 Privacy |
| Dictation disabled in password fields | 8.3 | §5 |
| NO_PERSONALIZED_LEARNING fields: committed, not saved to history | 8.3 | §5 |
| History local (app-private), keep-audio, auto-delete 1/7/30 days, delete all audio, Erase all data (history+audio+keys+settings) | 3, 8.4 | §7.3 |
| Uninstall deletes everything | 8.4 | §8.1 Data deletion |
| Clipboard copy from tile/shortcut | 8.4 | §6 (see unsure item 3) |
| Play Data safety: audio and vocabulary collected, not shared, not ephemeral | 9 | §8.1 table |
| Google "Collect"/"Sharing" definitions | 9 | §8.1 quotes |
| Apple label "Data Not Collected" explanation | 9 | §8.1 paragraph before the table |
| No account -> nothing to delete | 9 | §8.1 Data deletion |

## 2. Legal quotes -> URL fetched -> exact text

Fetch method: WebFetch (summarising fetcher; returns quotes in segments). Source of the verbatim GDPR quotes: **gdpr-info.eu** (unofficial reproduction). EUR-Lex https://eur-lex.europa.eu/eli/reg/2016/679/oj was also fetched (380k chars; read to offset 200000). It corroborated the fragments "determines the purposes and means of the processing of personal data", "processes personal data on behalf of the controller" and "by a natural person in the course of a purely personal or household activity", but its fetcher output was paraphrase-style, so EUR-Lex was NOT used as the verbatim source. A human reviewer should confirm against EUR-Lex.

| Article | URL | Quote used in the policy |
|---|---|---|
| 4(7) | https://gdpr-info.eu/art-4-gdpr/ | "which, alone or jointly with others, determines the purposes and means of the processing of personal data" (full: "'controller' means the natural or legal person, public authority, agency or other body which, alone or jointly with others, determines the purposes and means of the processing of personal data;") |
| 4(8) | https://gdpr-info.eu/art-4-gdpr/ | "which processes personal data on behalf of the controller" (full: "'processor' means a natural or legal person, public authority, agency or other body which processes personal data on behalf of the controller;") |
| 2(2)(c) | https://gdpr-info.eu/art-2-gdpr/ | "by a natural person in the course of a purely personal or household activity" |
| 13(1) | https://gdpr-info.eu/art-13-gdpr/ | "Where personal data relating to a data subject are collected from the data subject, the controller shall, at the time when personal data are obtained, provide the data subject with all of the following information:" and 13(1)(a) "the identity and the contact details of the controller" (full (a): "...and, where applicable, of the controller's representative;") |
| 6(1) | https://gdpr-info.eu/art-6-gdpr/ | "Processing shall be lawful only if and to the extent that at least one of the following applies:" |
| Google "Collect" | https://support.google.com/googleplay/android-developer/answer/10787469 | "'Collect' means transmitting data from your app off a user's device." |
| Google "Sharing" | same | "'Sharing' refers to transferring user data collected from your app to a third party." |

Fetched but not used: Art. 6(1)(a) "the data subject has given consent to the processing of his or her personal data for one or more specific purposes;", 6(1)(b) "processing is necessary for the performance of a contract to which the data subject is party" (truncated by the fetcher). Google's "Service providers" exemption was fetched; the policy does not rely on it.

Note: the fetcher returned the sources' typographic quotes/apostrophes; the policy uses plain ASCII quotes.

## 3. Points for the legal reviewer / unsure

1. Role analysis (10.2): "not a controller, and not a processor either" is our reading of Art. 4(7)/(8), not a legal opinion. The argument that supplying the app could make the developer a joint controller is not discussed; the text only says an authority's or court's view prevails.
2. 10.3 household exemption: stated as depending on the user's own use, and as not relieving the provider. Recital 18 (Regulation applies to controllers/processors providing the means for personal processing) was NOT fetched and is not cited.
3. Statements not from the contract, added by the author: the clipboard sentence (8.4) and "if you contact us by email or a GitHub issue, we see what you send us and use it to answer you" (10.1). No legal basis (e.g. Art. 6(1)(f)) is named for replying to emails.
4. "Hiding the keyboard stops the recording" and "no redirects from a plain-HTTP address" are implementation details from §5 / §4.3; confirm they hold at release.
5. "Being prepared for Google Play" (privacy and terms): public launch is after iOS (§10); switch to a live statement at launch.
6. Google "not shared" rationale: contract §8.1 quotes "Transferring user data to a third party based on a specific user-initiated action" as the exemption; that sentence was not returned by this session's fetch (it returned the Service-provider exemption), so the policy paraphrases it ("made on your specific action") without quoting it.
7. The Android navigation path 'Settings -> Storage / "Erase all data"' in section 3 is approximate; the contract only says Settings has storage/retention and an erase-all action (§7.3, §7.4).
8. Re-check the Play Console Data safety question wording at submission (§8.1).

## Opus legal review (2026-10-17) — APPROVE-WITH-FIXES, applied
- All GDPR quotes (Art. 2(2)(c), 4(7), 4(8), 6(1), 13(1), 13(1)(a)) verified verbatim against EUR-Lex CELEX:32016R0679; Google quotes verified against answer/10787469 (curly apostrophe in "user’s" restored).
- B1: §10.1 now names the controller for support emails, Art. 6(1)(f), retention 12 months after closing (OWNER TO CONFIRM), rights Art. 15–18, 21, complaint Art. 77 / Prezes UODO.
- S1 keyboard wording (field type + one char before cursor), S2 Android vitals disclosure, S3 verbatim Google sharing exemption, S4 meta/TL;DR vs Play "collected", S5 sensitive-clipboard setting; NITs: settings path, HTTPS exception, vocabulary "where supported", 4.2 sentence order, Android permission withdrawal.
- Open before launch: "being prepared for Google Play" → live wording; Terms §4 Google Play counterpart.

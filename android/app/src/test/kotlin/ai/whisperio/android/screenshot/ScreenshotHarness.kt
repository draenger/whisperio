package ai.whisperio.android.screenshot

import ai.whisperio.android.history.Recording
import ai.whisperio.android.history.RecordingSource
import ai.whisperio.android.history.RecordingStatus
import ai.whisperio.android.ui.theme.WhisperioTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.Density
import com.github.takahirom.roborazzi.captureRoboImage

/**
 * Shared harness for the screenshot gate (Zryw pattern). Every test renders a stateless screen composable at a fixed
 * window size inside [WhisperioTheme] and compares it with the committed baseline in `src/test/snapshots/<name>.png`
 * (record: `recordRoborazziDebug`, verify: `verifyRoborazziDebug`). Pure JVM: Robolectric native graphics.
 * Every snapshot class runs once as [EN] (`<name>.png`) and once as [PL] (`<name>_pl.png`).
 */
object ScreenshotConfig {
    /** Pixel 7: 411x914 dp, en/pl is selected at class level. */
    const val PHONE = "+w411dp-h914dp-normal-long-notround-port-notnight-420dpi"

    /** 10" tablet landscape: 1280x800 dp. */
    const val TABLET = "+w1280dp-h800dp-xlarge-long-notround-land-notnight-240dpi"

    const val EN = "en-rUS"
    const val PL = "pl-rPL"
}

object Loc {
    val pl: Boolean get() = java.util.Locale.getDefault().language == "pl"
    fun t(en: String, pl: String): String = if (this.pl) pl else en
}

internal const val SNAPSHOT_DIR = "src/test/snapshots"

/** Fixed clock and fixtures: nothing in a baseline may depend on the wall clock. */
object Fx {
    /** 2026-10-17 09:41 UTC */
    const val NOW = 1_792_230_060_000L

    val done get() = Recording(
        id = "r1", createdAt = NOW - 5 * 60_000, durationMs = 12_000, status = RecordingStatus.DONE,
        provider = "openai", model = "whisper-1", language = "auto",
        transcript = Loc.t(
            "Remind me to send the invoice to Anna before Friday.",
            "Przypomnij mi, żeby wysłać fakturę do Anny przed piątkiem.",
        ),
        audioPath = "/data/r1.m4a", source = RecordingSource.KEYBOARD, inserted = true,
    )
    val doneTile get() = done.copy(
        id = "r2", createdAt = NOW - 3 * 3_600_000, source = RecordingSource.TILE, inserted = null,
        transcript = Loc.t("Buy oat milk and coffee.", "Kup mleko owsiane i kawę."),
    )
    val failed get() = done.copy(
        id = "r3", createdAt = NOW - 26 * 3_600_000, status = RecordingStatus.FAILED, transcript = null,
        error = "HTTP 401: Incorrect API key provided.", source = RecordingSource.APP, inserted = null,
    )
    val notInserted get() = done.copy(id = "r4", createdAt = NOW - 2 * 86_400_000, inserted = false)
    val all get() = listOf(done, doneTile, failed)

    /**
     * Longer dictations from earlier in the week (Mon-Wed, below the visible rows), so the History recap card shows
     * what a real week looks like instead of "about 0 minutes saved". Duration = words at 140 wpm (a normal speaking
     * pace); the card's numbers then come from the app's own formula (Recap.compute), nothing is typed in.
     */
    val week: List<Recording> get() = listOf(
        long("w1", 3, WEEK_EN[0], WEEK_PL[0]),
        long("w2", 4, WEEK_EN[1], WEEK_PL[1]),
        long("w3", 5, WEEK_EN[2], WEEK_PL[2]),
    )

    private fun long(id: String, daysAgo: Int, en: String, pl: String): Recording {
        val text = Loc.t(en, pl)
        val words = text.split(Regex("\\s+")).count { it.isNotBlank() }
        return done.copy(
            id = id, createdAt = NOW - daysAgo * 86_400_000L, durationMs = words * 60_000L / 140,
            transcript = text, source = RecordingSource.APP, inserted = null,
        )
    }
}

private val WEEK_EN = listOf(
    "Notes from the Monday planning call. We agreed to ship the onboarding changes first and leave the settings " +
        "redesign for the next sprint. Marta will finish the copy for the welcome screens by Wednesday, and Tom " +
        "takes the analytics review. The main risk is the vendor migration, which still has no date, so we keep it " +
        "out of this release. Action items: send the updated timeline to the client, book a usability session with " +
        "five people from the beta group, and check whether the tablet layout needs a second column. Next call on " +
        "Thursday at ten. Also remember that the office is closed on Friday, so any review that needs two people " +
        "should happen before Thursday evening. I will write the summary email tonight and attach the slides from " +
        "today, together with the list of open questions about the reporting dashboard.",
    "Draft reply to the landlord. Thank you for the quick answer about the heating. The technician came on Tuesday " +
        "morning and replaced the valve in the living room, and the radiator works again. The one in the bedroom is " +
        "still cold at night, so could you ask him to look at it during the next visit? I am at home every day after " +
        "four, or I can leave the key with the neighbour on the second floor. About the rent for next month, I will " +
        "transfer it on the first as usual. I also noticed that the bathroom window does not close properly, which " +
        "lets a lot of cold air in. It is not urgent, but it would be good to fix it before winter. Please let me " +
        "know which day suits the technician, and thanks again for sorting this out so fast.",
    "Ideas for the weekend trip. Leave Saturday at eight to miss the traffic, stop for breakfast in the small town " +
        "by the lake, then the long trail to the viewpoint, about four hours with breaks. Pack the rain jackets, the " +
        "power bank, and enough water for everyone, because there is no shop on the trail. For dinner try the place " +
        "with the fish soup that Anna recommended, and book a table in advance because it is always full on " +
        "Saturdays. On Sunday something shorter: the castle in the morning and the drive back after lunch. Check the " +
        "forecast on Friday evening and, if it rains, swap the days and do the museum on Saturday instead. Ask Piotr " +
        "if he still wants to join and whether he can bring the second car, so that we do not have to squeeze in.",
)

private val WEEK_PL = listOf(
    "Notatki z poniedziałkowego planowania. Ustaliliśmy, że najpierw wypuszczamy zmiany w onboardingu, a nowy " +
        "wygląd ustawień zostawiamy na kolejny sprint. Marta skończy teksty ekranów powitalnych do środy, a Tomek " +
        "bierze przegląd analityki. Największe ryzyko to migracja dostawcy, która wciąż nie ma terminu, więc nie " +
        "wchodzi do tego wydania. Do zrobienia: wysłać klientowi zaktualizowany harmonogram, umówić test z pięcioma " +
        "osobami z grupy beta i sprawdzić, czy układ na tablety potrzebuje drugiej kolumny. Kolejne spotkanie " +
        "w czwartek o dziesiątej. Pamiętajmy też, że w piątek biuro jest zamknięte, więc przeglądy, które wymagają " +
        "dwóch osób, muszą się odbyć do czwartku wieczorem. Podsumowanie wyślę dziś wieczorem razem ze slajdami " +
        "i listą otwartych pytań o panel raportów.",
    "Szkic odpowiedzi do właściciela mieszkania. Dziękuję za szybką odpowiedź w sprawie ogrzewania. Serwisant " +
        "przyszedł we wtorek rano i wymienił zawór w salonie, więc kaloryfer znowu działa. Ten w sypialni nadal jest " +
        "zimny w nocy, czy mógłby go obejrzeć przy następnej wizycie? Jestem w domu codziennie po szesnastej, mogę " +
        "też zostawić klucz u sąsiadki z drugiego piętra. Czynsz za przyszły miesiąc przeleję jak zwykle pierwszego. " +
        "Zauważyłem też, że okno w łazience się nie domyka i wpada przez nie dużo zimnego powietrza. To nic pilnego, " +
        "ale dobrze byłoby je naprawić przed zimą. Proszę dać znać, który dzień pasuje serwisantowi, i jeszcze raz " +
        "dziękuję za tak szybkie załatwienie sprawy.",
    "Pomysły na weekendowy wyjazd. Wyjazd w sobotę o ósmej, żeby ominąć korki, śniadanie w małym miasteczku nad " +
        "jeziorem, potem długi szlak na punkt widokowy, około czterech godzin z przerwami. Spakować kurtki " +
        "przeciwdeszczowe, powerbank i dużo wody dla wszystkich, bo na szlaku nie ma sklepu. Na kolację spróbować " +
        "lokalu z zupą rybną, który poleciła Anna, i zarezerwować stolik wcześniej, bo w soboty zawsze jest pełno. " +
        "W niedzielę coś krótszego: rano zamek, a po obiedzie powrót. Sprawdzić prognozę w piątek wieczorem i jeśli " +
        "będzie padać, zamienić dni i w sobotę pójść do muzeum. Zapytać Piotra, czy nadal chce jechać i czy może " +
        "wziąć drugi samochód, żebyśmy nie musieli się ściskać.",
)

/** Renders [content] on the app background and records / verifies `<name>[_dark][_pl].png`. */
@OptIn(com.github.takahirom.roborazzi.ExperimentalRoborazziApi::class)
internal fun ComposeContentTestRule.snapshot(
    name: String,
    dark: Boolean = false,
    fontScale: Float = 1f,
    content: @Composable () -> Unit,
) {
    val file = name + (if (dark) "_dark" else "") + (if (Loc.pl) "_pl" else "")
    setContent {
        WhisperioTheme(darkTheme = dark) {
            val base = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(base.density, fontScale)) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                    contentColor = MaterialTheme.colorScheme.onBackground,
                ) { content() }
            }
        }
    }
    waitForIdle()
    onRoot().captureRoboImage("$SNAPSHOT_DIR/$file.png")
}

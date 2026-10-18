package ai.whisperio.android

import ai.whisperio.android.ui.nav.AppRoot
import ai.whisperio.android.ui.theme.WhisperioTheme
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            WhisperioTheme { AppRoot() }
        }
    }
}

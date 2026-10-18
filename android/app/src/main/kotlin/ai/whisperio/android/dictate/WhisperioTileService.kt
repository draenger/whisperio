package ai.whisperio.android.dictate

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/** Quick Settings tile: opens the translucent [DictateActivity] (CONTRACT 6). */
class WhisperioTileService : TileService() {

    override fun onStartListening() {
        super.onStartListening()
        qsTile?.apply {
            state = Tile.STATE_INACTIVE
            updateTile()
        }
    }

    override fun onClick() {
        super.onClick()
        if (isLocked) unlockAndRun { launchDictate() } else launchDictate()
    }

    // The Intent overload is only reached below API 34 (it throws from 34 on), so the lint error is a false positive.
    @SuppressLint("StartActivityAndCollapseDeprecated")
    private fun launchDictate() {
        val intent = TileLaunch.dictateIntent(this)
        if (TileLaunch.usesPendingIntent(Build.VERSION.SDK_INT)) {
            startActivityAndCollapse(TileLaunch.pendingFor(this, intent))
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }
}

/** Pure launch pieces of the tile, split out so the API-level branch is unit-testable without a TileService binder. */
internal object TileLaunch {
    const val SOURCE = "tile"

    /** API 34 removed the Intent overload of startActivityAndCollapse; PendingIntent is required from there. */
    fun usesPendingIntent(sdk: Int): Boolean = sdk >= 34

    fun dictateIntent(context: Context): Intent = Intent(context, DictateActivity::class.java)
        .putExtra(DictateActivity.EXTRA_SOURCE, SOURCE)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    fun pendingFor(context: Context, intent: Intent): PendingIntent = PendingIntent.getActivity(
        context, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
}

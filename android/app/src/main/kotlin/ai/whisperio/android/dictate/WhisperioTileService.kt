package ai.whisperio.android.dictate

import android.annotation.SuppressLint
import android.app.PendingIntent
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
        val intent = Intent(this, DictateActivity::class.java)
            .putExtra(DictateActivity.EXTRA_SOURCE, "tile")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= 34) {
            val pending = PendingIntent.getActivity(
                this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            startActivityAndCollapse(pending)
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }
}

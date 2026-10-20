package ai.whisperio.android.widget

import ai.whisperio.android.R
import ai.whisperio.android.dictate.DictateActivity
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/** Pure launch pieces of the home-screen widget (CONTRACT-1.1 F8), split out so they are unit-testable. */
internal object WidgetLaunch {
    /** Value of [DictateActivity.EXTRA_SOURCE] that maps to [ai.whisperio.android.history.RecordingSource.WIDGET]. */
    const val SOURCE = "widget"

    fun dictateIntent(context: Context): Intent = Intent(context, DictateActivity::class.java)
        .putExtra(DictateActivity.EXTRA_SOURCE, SOURCE)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /** Explicit intent, immutable: nothing outside the app can redirect or fill it in. */
    fun pendingFor(context: Context): PendingIntent = PendingIntent.getActivity(
        context, 0, dictateIntent(context), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
}

/**
 * One "Dictate" button that opens the same translucent [DictateActivity] as the QS tile and the launcher shortcut.
 * No periodic updates and no data on the widget (no transcript on the home screen).
 */
abstract class DictateWidgetProvider(private val layout: Int) : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        val views = RemoteViews(context.packageName, layout)
        views.setOnClickPendingIntent(R.id.widget_root, WidgetLaunch.pendingFor(context))
        appWidgetManager.updateAppWidget(appWidgetIds, views)
    }
}

/** 1x1: the microphone only. */
class DictateWidget1x1 : DictateWidgetProvider(R.layout.widget_dictate_1x1)

/** 2x1: the microphone and the label. */
class DictateWidget2x1 : DictateWidgetProvider(R.layout.widget_dictate_2x1)

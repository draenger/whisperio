package ai.whisperio.android

import ai.whisperio.android.di.AppGraph
import android.app.Application

class WhisperioApp : Application() {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
        graph.runMaintenance()
    }
}

val android.content.Context.graph: AppGraph
    get() = (applicationContext as WhisperioApp).graph

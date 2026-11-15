package com.aurastudy.app.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.webkit.JavascriptInterface
import android.webkit.WebView

class AuraStudyWidgetBridge(private val context: Context) {

  @JavascriptInterface
  fun updateWidgetSnapshot(snapshotJson: String) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit().putString(KEY_SNAPSHOT, snapshotJson).apply()

    val appWidgetManager = AppWidgetManager.getInstance(context)
    val widgetComponent = ComponentName(context, AuraStudyWidgetProvider::class.java)
    val appWidgetIds = appWidgetManager.getAppWidgetIds(widgetComponent)

    if (appWidgetIds.isNotEmpty()) {
      val updateIntent = Intent(context, AuraStudyWidgetProvider::class.java).apply {
        action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
        putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, appWidgetIds)
      }
      context.sendBroadcast(updateIntent)
    }
  }

  companion object {
    const val JS_INTERFACE_NAME = "AuraStudyAndroidBridge"
    const val PREFS_NAME = "aurastudy_widget_prefs"
    const val KEY_SNAPSHOT = "aurastudy.widget.snapshot.v1"

    @JvmStatic
    fun registerWithWebView(webView: WebView, context: Context) {
      webView.addJavascriptInterface(
        AuraStudyWidgetBridge(context.applicationContext),
        JS_INTERFACE_NAME
      )
    }
  }
}

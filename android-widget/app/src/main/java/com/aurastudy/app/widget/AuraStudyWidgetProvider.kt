package com.aurastudy.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import com.aurastudy.app.R
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

class AuraStudyWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray
  ) {
    for (appWidgetId in appWidgetIds) {
      updateAppWidget(context, appWidgetManager, appWidgetId)
    }
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: Bundle
  ) {
    super.onAppWidgetOptionsChanged(context, appWidgetManager, appWidgetId, newOptions)
    updateAppWidget(context, appWidgetManager, appWidgetId)
  }

  companion object {
    private data class RowSlot(
      val rowId: Int,
      val stripeId: Int,
      val timeId: Int,
      val titleId: Int
    )

    private data class WidgetRowItem(
      val isDeadline: Boolean,
      val timeLabel: String,
      val title: String,
      val sortEpochMs: Long,
      val isExpired: Boolean
    )

    private val ROW_SLOTS = arrayOf(
      RowSlot(
        R.id.widget_item_row_1,
        R.id.widget_item_stripe_1,
        R.id.widget_item_time_1,
        R.id.widget_item_title_1
      ),
      RowSlot(
        R.id.widget_item_row_2,
        R.id.widget_item_stripe_2,
        R.id.widget_item_time_2,
        R.id.widget_item_title_2
      ),
      RowSlot(
        R.id.widget_item_row_3,
        R.id.widget_item_stripe_3,
        R.id.widget_item_time_3,
        R.id.widget_item_title_3
      ),
      RowSlot(
        R.id.widget_item_row_4,
        R.id.widget_item_stripe_4,
        R.id.widget_item_time_4,
        R.id.widget_item_title_4
      )
    )

    private val WEEKDAY_ZH = arrayOf("日", "一", "二", "三", "四", "五", "六")
    private val ISO_DATE_REGEX = Regex("""^(\d{4})-(\d{2})-(\d{2})$""")
    private val TIME_HHMM_REGEX = Regex("""^(\d{2}):(\d{2})$""")

    fun updateAppWidget(
      context: Context,
      appWidgetManager: AppWidgetManager,
      appWidgetId: Int
    ) {
      val views = RemoteViews(context.packageName, R.layout.widget_aurastudy)

      val launchIntent = context.packageManager
        .getLaunchIntentForPackage(context.packageName)
        ?.apply {
          flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }

      if (launchIntent != null) {
        val pendingIntent = PendingIntent.getActivity(
          context,
          0,
          launchIntent,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        views.setOnClickPendingIntent(R.id.widget_root, pendingIntent)
        views.setOnClickPendingIntent(R.id.widget_header, pendingIntent)
      }

      val prefs = context.getSharedPreferences(
        AuraStudyWidgetBridge.PREFS_NAME,
        Context.MODE_PRIVATE
      )
      val rawJson = prefs.getString(AuraStudyWidgetBridge.KEY_SNAPSHOT, null)
      val nowMs = System.currentTimeMillis()

      if (rawJson.isNullOrBlank()) {
        bindEmptyState(views, formatHeaderDate(null, nowMs))
      } else {
        try {
          bindSnapshot(context, views, JSONObject(rawJson), nowMs)
        } catch (_: Exception) {
          bindEmptyState(views, formatHeaderDate(null, nowMs))
        }
      }

      appWidgetManager.updateAppWidget(appWidgetId, views)
    }

    private fun bindEmptyState(views: RemoteViews, headerDateText: String) {
      views.setTextViewText(R.id.widget_date_label, headerDateText)
      views.setTextViewText(R.id.widget_status_pill, "全部完成")
      views.setViewVisibility(R.id.widget_empty_state, View.VISIBLE)
      views.setTextViewText(R.id.widget_empty_text, "今日無待辦排程・點擊規劃")
      views.setViewVisibility(R.id.widget_items_container, View.GONE)
      for (slot in ROW_SLOTS) {
        views.setViewVisibility(slot.rowId, View.GONE)
      }
    }

    private fun bindSnapshot(
      context: Context,
      views: RemoteViews,
      snapshot: JSONObject,
      nowMs: Long
    ) {
      val dateLabelRaw = snapshot.optString("dateLabel", "").trim()
      val baseDateStr = if (ISO_DATE_REGEX.matches(dateLabelRaw)) {
        dateLabelRaw
      } else {
        formatIsoDate(nowMs)
      }
      views.setTextViewText(R.id.widget_date_label, formatHeaderDate(baseDateStr, nowMs))

      val rowItems = mutableListOf<WidgetRowItem>()

      val schedules = snapshot.optJSONArray("todaySchedules") ?: JSONArray()
      for (i in 0 until schedules.length()) {
        val obj = schedules.optJSONObject(i) ?: continue
        val title = obj.optString("title", "").trim()
        if (title.isEmpty()) continue

        val start = obj.optString("startTimeLabel", "").trim()
        val end = obj.optString("endTimeLabel", "").trim()
        val timeLabel = when {
          start.isNotEmpty() && end.isNotEmpty() -> "$start - $end"
          start.isNotEmpty() -> start
          else -> end
        }

        val startMs = parseLocalDateTimeMs(baseDateStr, start, fallbackEndOfDay = false)
        var endMs = parseLocalDateTimeMs(baseDateStr, end, fallbackEndOfDay = false)
        if (startMs > 0L && endMs > 0L && endMs <= startMs) {
          endMs += 24L * 60L * 60L * 1000L
        }
        val isExpired = endMs > 0L && endMs <= nowMs

        rowItems.add(
          WidgetRowItem(
            isDeadline = false,
            timeLabel = timeLabel.ifEmpty { "全天時段" },
            title = title,
            sortEpochMs = if (startMs > 0L) startMs else Long.MAX_VALUE / 2,
            isExpired = isExpired
          )
        )
      }

      val deadlines = snapshot.optJSONArray("upcomingDeadlines") ?: JSONArray()
      for (i in 0 until deadlines.length()) {
        val obj = deadlines.optJSONObject(i) ?: continue
        val title = obj.optString("title", "").trim()
        if (title.isEmpty()) continue

        val dueRaw = obj.optString("dueDateLabel", "").trim()
        val parts = dueRaw.split(" ", limit = 2)
        val dueDatePart = parts.getOrNull(0).orEmpty()
        val dueTimePart = parts.getOrNull(1).orEmpty()

        val timeLabel = formatDeadlineTimeLabel(baseDateStr, dueDatePart, dueTimePart)
        val dueEpochMs = if (ISO_DATE_REGEX.matches(dueDatePart)) {
          parseLocalDateTimeMs(
            dueDatePart,
            dueTimePart,
            fallbackEndOfDay = dueTimePart.isEmpty()
          )
        } else {
          Long.MAX_VALUE / 2
        }
        val isExpired = dueEpochMs in 1L..nowMs

        rowItems.add(
          WidgetRowItem(
            isDeadline = true,
            timeLabel = timeLabel,
            title = title,
            sortEpochMs = if (dueEpochMs > 0L) dueEpochMs else Long.MAX_VALUE / 2,
            isExpired = isExpired
          )
        )
      }

      val remainingScheduleOverflow = snapshot.optInt("remainingCount", 0).coerceAtLeast(0)
      val activeCount = rowItems.count { !it.isExpired } + remainingScheduleOverflow
      views.setTextViewText(
        R.id.widget_status_pill,
        if (activeCount > 0) "今日剩餘 ${activeCount} 項" else "全部完成"
      )

      if (rowItems.isEmpty()) {
        views.setViewVisibility(R.id.widget_empty_state, View.VISIBLE)
        views.setTextViewText(R.id.widget_empty_text, "今日無待辦排程・點擊規劃")
        views.setViewVisibility(R.id.widget_items_container, View.GONE)
        for (slot in ROW_SLOTS) {
          views.setViewVisibility(slot.rowId, View.GONE)
        }
        return
      }

      // Prioritize upcoming/active items before expired items, sorted chronologically.
      val orderedItems = rowItems.sortedWith(
        compareBy<WidgetRowItem> { it.isExpired }.thenBy { it.sortEpochMs }
      )

      views.setViewVisibility(R.id.widget_empty_state, View.GONE)
      views.setViewVisibility(R.id.widget_items_container, View.VISIBLE)

      for (index in ROW_SLOTS.indices) {
        val slot = ROW_SLOTS[index]
        if (index < orderedItems.size) {
          val item = orderedItems[index]
          views.setViewVisibility(slot.rowId, View.VISIBLE)
          views.setImageViewResource(
            slot.stripeId,
            if (item.isDeadline) R.drawable.widget_stripe_deadline else R.drawable.widget_stripe_schedule
          )
          views.setTextViewText(slot.timeId, item.timeLabel)
          views.setTextViewText(slot.titleId, item.title)

          if (item.isExpired) {
            views.setFloat(slot.rowId, "setAlpha", 0.52f)
            views.setInt(slot.rowId, "setBackgroundResource", R.drawable.widget_row_expired_bg)
            setTextColorRes(context, views, slot.titleId, R.color.widget_text_secondary)
          } else {
            views.setFloat(slot.rowId, "setAlpha", 1.0f)
            views.setInt(slot.rowId, "setBackgroundResource", R.drawable.widget_row_bg)
            setTextColorRes(context, views, slot.titleId, R.color.widget_text_primary)
          }
        } else {
          views.setViewVisibility(slot.rowId, View.GONE)
        }
      }
    }

    private fun setTextColorRes(
      context: Context,
      views: RemoteViews,
      viewId: Int,
      colorResId: Int
    ) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        views.setColor(viewId, "setTextColor", colorResId)
      } else {
        val resolved = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          context.getColor(colorResId)
        } else {
          @Suppress("DEPRECATION")
          context.resources.getColor(colorResId)
        }
        views.setTextColor(viewId, resolved)
      }
    }

    private fun formatIsoDate(epochMs: Long): String {
      val cal = Calendar.getInstance().apply { timeInMillis = epochMs }
      val year = cal.get(Calendar.YEAR)
      val month = cal.get(Calendar.MONTH) + 1
      val day = cal.get(Calendar.DAY_OF_MONTH)
      return "%04d-%02d-%02d".format(year, month, day)
    }

    private fun formatHeaderDate(isoDate: String?, fallbackNowMs: Long): String {
      val cal = Calendar.getInstance()
      val match = isoDate?.let { ISO_DATE_REGEX.matchEntire(it) }
      if (match != null) {
        cal.set(
          match.groupValues[1].toInt(),
          match.groupValues[2].toInt() - 1,
          match.groupValues[3].toInt(),
          12,
          0,
          0
        )
      } else {
        cal.timeInMillis = fallbackNowMs
      }
      val month = cal.get(Calendar.MONTH) + 1
      val day = cal.get(Calendar.DAY_OF_MONTH)
      val weekdayIdx = (cal.get(Calendar.DAY_OF_WEEK) - Calendar.SUNDAY).coerceIn(0, 6)
      return "${month}月${day}日 週${WEEKDAY_ZH[weekdayIdx]}"
    }

    private fun formatDeadlineTimeLabel(
      baseDateStr: String,
      dueDatePart: String,
      dueTimePart: String
    ): String {
      if (dueDatePart == baseDateStr) {
        return if (dueTimePart.isNotEmpty()) "截止 $dueTimePart" else "今日截止"
      }
      val dateMatch = ISO_DATE_REGEX.matchEntire(dueDatePart)
      if (dateMatch != null) {
        val month = dateMatch.groupValues[2].toInt()
        val day = dateMatch.groupValues[3].toInt()
        return if (dueTimePart.isNotEmpty()) {
          "截止 $month/$day $dueTimePart"
        } else {
          "截止 $month/$day"
        }
      }
      return if (dueDatePart.isNotEmpty()) "截止 $dueDatePart" else "近期截止"
    }

    private fun parseLocalDateTimeMs(
      isoDate: String,
      hhmm: String,
      fallbackEndOfDay: Boolean
    ): Long {
      val dateMatch = ISO_DATE_REGEX.matchEntire(isoDate) ?: return 0L
      val year = dateMatch.groupValues[1].toInt()
      val month = dateMatch.groupValues[2].toInt() - 1
      val day = dateMatch.groupValues[3].toInt()

      val timeMatch = TIME_HHMM_REGEX.matchEntire(hhmm)
      val cal = Calendar.getInstance()
      cal.set(Calendar.MILLISECOND, 0)
      if (timeMatch != null) {
        cal.set(
          year,
          month,
          day,
          timeMatch.groupValues[1].toInt(),
          timeMatch.groupValues[2].toInt(),
          0
        )
      } else if (fallbackEndOfDay) {
        cal.set(year, month, day, 23, 59, 59)
      } else {
        return 0L
      }
      return cal.timeInMillis
    }
  }
}

package it.campopronto.ads

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

object BookingReminders {
    private fun intent(context: Context, id: String) =
        PendingIntent.getBroadcast(
            context,
            id.hashCode(),
            Intent(context, BookingReminderReceiver::class.java).setAction("booking:$id"),
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
        )

    fun clear(context: Context) {
        val prefs = context.getSharedPreferences("reminders", 0)
        val alarm = context.getSystemService(AlarmManager::class.java)
        prefs.getStringSet("ids", emptySet())!!.forEach { id ->
            intent(context, id)?.let {
                alarm.cancel(it)
                it.cancel()
            }
        }
        prefs.edit().clear().apply()
    }

    fun sync(context: Context, bookings: List<Booking>, fields: List<Court>, enabled: Boolean) {
        clear(context)
        if (
            !enabled ||
                (Build.VERSION.SDK_INT >= 33 &&
                    ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.POST_NOTIFICATIONS,
                    ) != PackageManager.PERMISSION_GRANTED)
        )
            return
        val alarm = context.getSystemService(AlarmManager::class.java)
        val ids = mutableSetOf<String>()
        bookings
            .filter { it.status != "cancelled" }
            .forEach { b ->
                val at =
                    (Clock.instant(b.date, b.time)?.toEpochMilli() ?: return@forEach) - 30 * 60_000
                if (at <= System.currentTimeMillis()) return@forEach
                val i =
                    Intent(context, BookingReminderReceiver::class.java)
                        .setAction("booking:${b.id}")
                        .putExtra(
                            "title",
                            fields.find { it.id == b.fieldId }?.name ?: "La tua partita",
                        )
                        .putExtra("time", b.time)
                val p =
                    PendingIntent.getBroadcast(
                        context,
                        b.id.hashCode(),
                        i,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    )
                alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, p)
                ids.add(b.id)
            }
        context.getSharedPreferences("reminders", 0).edit().putStringSet("ids", ids).apply()
    }
}

class BookingReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (
            Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.POST_NOTIFICATIONS,
                ) != PackageManager.PERMISSION_GRANTED
        )
            return
        val manager = context.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26)
            manager.createNotificationChannel(
                NotificationChannel(
                    "bookings",
                    "Promemoria partite",
                    NotificationManager.IMPORTANCE_DEFAULT,
                )
            )
        val tap =
            PendingIntent.getActivity(
                context,
                0,
                Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val n =
            NotificationCompat.Builder(context, "bookings")
                .setSmallIcon(android.R.drawable.ic_menu_my_calendar)
                .setContentTitle(intent.getStringExtra("title"))
                .setContentText("La partita inizia alle ${intent.getStringExtra("time")}")
                .setContentIntent(tap)
                .setAutoCancel(true)
                .build()
        manager.notify(intent.action.hashCode(), n)
    }
}

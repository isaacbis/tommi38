package it.campopronto.ads

import java.time.*
import java.time.format.DateTimeFormatter
import kotlinx.serialization.Serializable

@Serializable
data class Venue(
    val id: String,
    val name: String,
    val city: String? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val enabled: Boolean? = null,
    val visibility: String? = null,
)

@Serializable data class Court(val id: String, val name: String)

@Serializable
data class Photo(val url: String, val caption: String? = null, val link: String? = null)

@Serializable
data class VenueConfig(
    val slotMinutes: Int = 40,
    val dayStart: String = "08:00",
    val dayEnd: String = "23:00",
    val maxBookingsPerUserPerDay: Int = 1,
    val maxActiveBookingsPerUser: Int = 1,
    val fields: List<Court> = emptyList(),
    val notesText: String? = null,
    val gallery: List<Photo> = emptyList(),
    val registrationEnabled: Boolean = false,
)

@Serializable
data class Member(
    val username: String,
    val role: String,
    val credits: Int = 0,
    val demo: Boolean = false,
    val demoExpiresAt: Double? = null,
    val platformAdmin: Boolean = false,
    val managementMode: Boolean = false,
    val establishment: Venue? = null,
) {
    val isManager
        get() = role == "admin" || platformAdmin
}

@Serializable
data class Booking(
    val id: String,
    val fieldId: String,
    val date: String,
    val time: String,
    val user: String? = null,
    val status: String? = null,
    val slotMinutes: Int? = null,
) {
    fun overlaps(day: String, field: String, slot: String, duration: Int, fallback: Int) =
        date == day &&
            fieldId == field &&
            status != "cancelled" &&
            Clock.overlap(slot, duration, time, slotMinutes ?: fallback)
}

@Serializable
data class Closure(
    val id: String,
    val fieldId: String,
    val date: String? = null,
    val startDate: String? = null,
    val endDate: String? = null,
    val start: String,
    val end: String,
    val reason: String? = null,
) {
    fun contains(day: String, slot: String, duration: Int): Boolean {
        val first = startDate ?: date ?: ""
        val last = endDate ?: date ?: first
        return day >= first &&
            day <= last &&
            Clock.overlap(slot, duration, start, Clock.minutes(end) - Clock.minutes(start))
    }
}

@Serializable
data class CreditMovement(
    val id: String,
    val delta: Int,
    val reason: String,
    val at: String? = null,
)

@Serializable data class Credits(val balance: Int, val items: List<CreditMovement>)

@Serializable
data class Bookings(val items: List<Booking>, val closures: List<Closure> = emptyList())

@Serializable data class Items<T>(val items: List<T>)

@Serializable
data class AdsStatus(
    val available: Boolean = false,
    val earned: Boolean = false,
    val remainingVideos: Int = 0,
)

@Serializable data class RewardToken(val token: String)

@Serializable data class DemoResult(val establishmentId: String, val expiresAt: Double)

@Serializable data class Credential(val username: String, val password: String)

@Serializable
data class RegistrationResult(
    val establishmentId: String,
    val name: String,
    val manager: Credential,
    val credentials: List<Credential>,
)

@Serializable
data class ManagedUser(
    val username: String,
    val role: String,
    val credits: Int,
    val disabled: Boolean = false,
    val pendingApproval: Boolean = false,
)

@Serializable
data class WaitEntry(
    val id: String,
    val fieldId: String,
    val date: String,
    val time: String,
    val available: Boolean = false,
)

@Serializable
data class PlayerRequest(
    val id: String,
    val status: String? = null,
    val participantNames: List<String> = emptyList(),
    val phone: String? = null,
    val requesterUser: String? = null,
)

@Serializable
data class PlayerSearch(
    val id: String,
    val reservationId: String,
    val fieldId: String,
    val date: String,
    val time: String,
    val note: String? = null,
    val spotsAvailable: Int? = null,
    val spotsNeeded: Int? = null,
    val isOwner: Boolean = false,
    val canManage: Boolean = false,
    val myRequest: PlayerRequest? = null,
    val requests: List<PlayerRequest> = emptyList(),
)

@Serializable
data class Operations(
    val closures: List<Closure> = emptyList(),
    val users: Int = 0,
    val credits: Int = 0,
    val upcoming: Int = 0,
    val byField: Map<String, Int> = emptyMap(),
)

@Serializable data class Weather(val daily: WeatherDaily? = null)

@Serializable
data class WeatherDaily(
    val time: List<String>,
    val weathercode: List<Int>,
    val temperature_2m_max: List<Double>,
    val temperature_2m_min: List<Double>,
)

object Clock {
    val zone: ZoneId = ZoneId.of("Europe/Rome")

    fun today(): String = LocalDate.now(zone).toString()

    fun validTime(value: String) =
        Regex("^[0-9]{2}:[0-9]{2}$").matches(value) &&
            runCatching {
                    LocalTime.parse(value)
                    true
                }
                .getOrDefault(false)

    fun minutes(value: String): Int =
        if (validTime(value)) value.take(2).toInt() * 60 + value.takeLast(2).toInt() else 0

    fun slots(c: VenueConfig): List<String> {
        if (c.slotMinutes <= 0 || !validTime(c.dayStart) || !validTime(c.dayEnd)) return emptyList()
        return (minutes(c.dayStart)..(minutes(c.dayEnd) - c.slotMinutes) step c.slotMinutes).map {
            "%02d:%02d".format(it / 60, it % 60)
        }
    }

    fun overlap(a: String, ad: Int, b: String, bd: Int) =
        minutes(a) < minutes(b) + bd && minutes(a) + ad > minutes(b)

    fun instant(day: String, time: String): Instant? =
        runCatching {
                LocalDateTime.parse("$day $time", DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))
                    .atZone(zone)
                    .toInstant()
            }
            .getOrNull()

    fun past(day: String, time: String) = instant(day, time)?.isBefore(Instant.now()) ?: true

    fun countValid(value: String) = value.toIntOrNull() in 1..1000

    fun distance(lat: Double, lon: Double, v: Venue): Double {
        if (v.latitude == null || v.longitude == null) return Double.MAX_VALUE
        val a = Math.toRadians(lat)
        val b = Math.toRadians(v.latitude)
        val d = Math.toRadians(v.longitude - lon)
        return 6371 *
            Math.acos(
                (Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos(d)).coerceIn(
                    -1.0,
                    1.0,
                )
            )
    }
}

class ApiException(val code: String) :
    Exception(
        when (code) {
            "INVALID_LOGIN",
            "INVALID_CREDENTIALS",
            "BAD_CREDENTIALS" -> "Username o password non corretti."
            "NO_CREDITS",
            "INSUFFICIENT_CREDITS" -> "Non hai crediti sufficienti."
            "SLOT_BUSY",
            "SLOT_TAKEN",
            "CONFLICT" -> "Questo orario è appena stato prenotato. Aggiorna i campi."
            "DEMO_EXPIRED" -> "I dieci minuti della demo sono terminati."
            "FORBIDDEN",
            "GLOBAL_ADMIN_REQUIRED" -> "Operazione non consentita con il tuo ruolo."
            "UNAUTHORIZED" -> "Accedi di nuovo per continuare."
            "DAILY_REWARD_LIMIT",
            "REWARD_DAILY_LIMIT" -> "Hai già ottenuto il credito di oggi."
            "REWARD_PENDING" -> "Video ancora in verifica. Aggiorna il saldo tra poco."
            "ADS_UNAVAILABLE" -> "Al momento non ci sono annunci disponibili. Riprova più tardi."
            "FIELD_CLOSED" -> "Il campo è chiuso nell’orario scelto."
            "MAX_PER_DAY_LIMIT",
            "ACTIVE_BOOKING_LIMIT",
            "BOOKING_LIMIT" -> "Hai raggiunto il limite di prenotazioni."
            "PAST_DATE_NOT_ALLOWED",
            "PAST_TIME_NOT_ALLOWED" -> "Scegli una data e un orario futuri."
            "REGISTRATION_ALREADY_CREATED" ->
                "Registrazione già completata. Contatta l’assistenza se non hai salvato il PDF."
            "REGISTRATION_LIMIT" -> "Limite giornaliero di registrazioni raggiunto."
            "EXISTING_RESERVATIONS" ->
                "Il periodo contiene prenotazioni: gestiscile prima di chiudere il campo."
            "NETWORK" -> "Connessione non disponibile. Riprova."
            else -> "Operazione non riuscita. Controlla i dati e riprova."
        }
    )

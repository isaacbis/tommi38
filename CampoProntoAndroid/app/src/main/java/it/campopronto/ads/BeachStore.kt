package it.campopronto.ads

import android.app.Application
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

class BeachStore(app: Application) : AndroidViewModel(app) {
    val api = Api(app)
    private val prefs = app.getSharedPreferences("settings", 0)
    var venues by mutableStateOf<List<Venue>>(emptyList())
    var selected by mutableStateOf<Venue?>(null)
    var member by mutableStateOf<Member?>(null)
    var config by mutableStateOf(VenueConfig())
    var bookings by mutableStateOf<List<Booking>>(emptyList())
    var mine by mutableStateOf<List<Booking>>(emptyList())
    var closures by mutableStateOf<List<Closure>>(emptyList())
    var movements by mutableStateOf<List<CreditMovement>>(emptyList())
    var waiting by mutableStateOf<List<WaitEntry>>(emptyList())
    var searches by mutableStateOf<List<PlayerSearch>>(emptyList())
    var users by mutableStateOf<List<ManagedUser>>(emptyList())
    var ads by mutableStateOf(AdsStatus())
    var weather by mutableStateOf<Weather?>(null)
    var registrationResult by mutableStateOf<RegistrationResult?>(null)
    var registrationPdfSaved by mutableStateOf(false)
    val registrationRequestId = java.util.UUID.randomUUID().toString()
    var message by mutableStateOf<String?>(null)
    var busy by mutableStateOf(false)
    var loading by mutableStateOf(true)
    var day by mutableStateOf(Clock.today())
    var loginAdPending by mutableStateOf(false)
    private var generation = 0
    private var dayGeneration = 0
    var reminders by mutableStateOf(prefs.getBoolean("reminders", false))

    init {
        perform {
            try {
                loadVenues()
                prefs.getString("venue", null)?.let { id ->
                    selected = venues.find { it.id == id } ?: Venue(id, "CampoPronto ADS")
                    try {
                        member = request("me")
                        refresh()
                    } catch (e: Exception) {
                        clearSession()
                    }
                }
            } finally {
                loading = false
            }
        }
    }

    suspend inline fun <reified T> request(
        path: String,
        method: String = "GET",
        body: JsonObject? = null,
    ): T = api.json.decodeFromJsonElement(requestRaw(path, method, body))

    suspend fun requestRaw(
        path: String,
        method: String = "GET",
        body: JsonObject? = null,
    ): JsonElement {
        val expected = generation
        try {
            val result = api.request(path, selected?.id, method, body)
            if (expected != generation) throw kotlinx.coroutines.CancellationException()
            return result
        } catch (e: ApiException) {
            if (e.code == "DEMO_EXPIRED") clearSession()
            throw e
        }
    }

    suspend fun mutate(path: String, method: String = "POST", body: JsonObject = payload()) {
        requestRaw(path, method, body)
    }

    fun perform(action: suspend () -> Unit) {
        if (busy) return
        busy = true
        viewModelScope.launch {
            try {
                action()
            } catch (e: kotlinx.coroutines.CancellationException) {} catch (e: Exception) {
                message = e.message ?: "Operazione non riuscita."
            } finally {
                busy = false
                loading = false
            }
        }
    }

    suspend fun loadVenues() {
        venues = request<Items<Venue>>("establishments").items
    }

    fun choose(v: Venue) {
        perform {
            generation++
            selected = v
            config = VenueConfig()
            config = request("public/config")
        }
    }

    fun back() {
        if (!busy) {
            generation++
            selected = null
            config = VenueConfig()
        }
    }

    fun login(username: String, password: String) {
        perform {
            mutate("login", body = payload("username" to username.trim(), "password" to password))
            member = request("me")
            prefs.edit().putString("venue", selected?.id).apply()
            loginAdPending = true
            refresh()
        }
    }

    suspend fun refresh() {
        config = request("public/config")
        member = request("me")
        member?.establishment?.let { selected = it }
        mine =
            if (member?.managementMode != true) request<Items<Booking>>("reservations/mine").items
            else emptyList()
        loadDay()
        BookingReminders.sync(
            getApplication(),
            mine,
            config.fields,
            reminders && member?.demo != true,
        )
    }

    suspend fun loadDay() {
        val current = day
        val token = ++dayGeneration
        val result = request<Bookings>("reservations?date=$current")
        if (token == dayGeneration && day == current) {
            bookings = result.items
            closures = result.closures
        }
    }

    suspend fun loadCredits() {
        val result = request<Credits>("credits")
        movements = result.items
        member = member?.copy(credits = result.balance)
        ads = request("ads/status")
    }

    suspend fun loadCommunity() {
        searches = request<Items<PlayerSearch>>("player-searches").items
        waiting =
            if (member?.managementMode != true) request<Items<WaitEntry>>("waitlist").items
            else emptyList()
    }

    suspend fun loadUsers() {
        users = request<Items<ManagedUser>>("admin/users").items
    }

    fun demo(setup: JsonObject?) {
        perform {
            val r =
                request<DemoResult>(
                    "demo/public",
                    "POST",
                    if (setup != null) payload("setup" to setup) else payload(),
                )
            selected =
                Venue(
                    r.establishmentId,
                    setup?.get("name")?.jsonPrimitive?.content ?: "La tua demo",
                )
            prefs.edit().putString("venue", r.establishmentId).apply()
            member = request("me")
            refresh()
        }
    }

    fun demoRole() {
        perform {
            mutate(
                "demo/enter",
                body = payload("role" to if (member?.isManager == true) "user" else "admin"),
            )
            member = request("me")
            refresh()
        }
    }

    fun logout() {
        perform {
            runCatching { mutate(if (member?.demo == true) "demo/exit" else "logout") }
            clearSession()
        }
    }

    fun clearSession() {
        generation++
        dayGeneration++
        api.clear()
        prefs.edit().remove("venue").apply()
        BookingReminders.clear(getApplication())
        member = null
        selected = null
        config = VenueConfig()
        bookings = emptyList()
        mine = emptyList()
        closures = emptyList()
        movements = emptyList()
        waiting = emptyList()
        searches = emptyList()
        users = emptyList()
        ads = AdsStatus()
        weather = null
        loginAdPending = false
        day = Clock.today()
    }

    fun updateReminders(enabled: Boolean) {
        reminders = enabled
        prefs.edit().putBoolean("reminders", enabled).apply()
        BookingReminders.sync(
            getApplication(),
            mine,
            config.fields,
            enabled && member?.demo != true,
        )
    }

    fun invite(id: String?) {
        if (id == null || !Regex("^[a-z0-9-]{1,60}$").matches(id)) return
        if (member != null) {
            message = "Esci dall’account prima di aprire un altro stabilimento."
            return
        }
        perform {
            val v =
                request<Items<Venue>>("establishments?code=$id").items.find { it.id == id }
                    ?: throw ApiException("ESTABLISHMENT_NOT_FOUND")
            generation++
            selected = v
            config = request("public/config")
        }
    }

    fun switchVenue(v: Venue) {
        perform {
            mutate("platform/context", body = payload("establishmentId" to v.id))
            generation++
            selected = v
            prefs.edit().putString("venue", v.id).apply()
            refresh()
        }
    }
}

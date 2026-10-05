package it.campopronto.ads

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import java.util.UUID
import kotlinx.serialization.json.*

@Composable
fun ManagementMenu(s: BeachStore, open: (String) -> Unit) {
    Page {
        Text("Gestisci ${s.selected?.name}", fontSize = 24.sp, fontWeight = FontWeight.Bold)
        listOf(
                "stats" to "Statistiche",
                "agenda" to "Prenotazioni per giorno",
                "users" to "Clienti e approvazioni",
                "settings" to "Campi, orari e foto",
                "closures" to "Chiusure e periodi bloccati",
                "reports" to "Segnalazioni giocatori",
                "recovery" to "Recupero password",
            )
            .forEach { (key, label) -> Panel { Action(label) { open(key) } } }
        if (s.member?.platformAdmin == true)
            Panel("Amministratore globale") {
                Action("Stabilimenti e gestori") { open("platform") }
            }
        Hint(
            "Ogni gestore può amministrare soltanto il proprio stabilimento. Solo l’amministratore globale può rettificare crediti."
        )
    }
}

@Composable
fun ManagementDetail(s: BeachStore, route: String, onDone: () -> Unit) {
    when (route) {
        "stats" -> Stats(s)
        "agenda" -> Agenda(s)
        "users" -> Users(s)
        "settings" -> Settings(s)
        "closures" -> Closures(s)
        "platform" -> Platform(s, onDone)
        "reports" -> Reports(s)
        "recovery" -> Recovery(s)
        else -> Hint("Seleziona una funzione di gestione.")
    }
}

@Composable
fun Stats(s: BeachStore) {
    var stats by remember { mutableStateOf<Operations?>(null) }
    LaunchedEffect(Unit) { s.perform { stats = s.request("admin/operations") } }
    Page {
        Panel("Statistiche") {
            Text("${stats?.users?:0} utenti")
            Text("${stats?.upcoming?:0} prenotazioni future")
            Text("${stats?.credits?:0} crediti complessivi")
            s.config.fields.forEach {
                Text("${it.name}: ${stats?.byField?.get(it.id)?:0} prenotazioni")
            }
        }
    }
}

@Composable
fun Agenda(s: BeachStore) {
    var day by remember { mutableStateOf(Clock.today()) }
    var items by remember { mutableStateOf<List<Booking>>(emptyList()) }
    var cancel by remember { mutableStateOf<Booking?>(null) }
    LaunchedEffect(day) {
        s.perform {
            val expected = day
            val response = s.request<Items<Booking>>("admin/reservations?date=$day")
            if (expected == day) items = response.items.sortedBy { it.time }
        }
    }
    Page {
        DayButton("Giorno", day) { day = it }
        if (items.isEmpty()) Hint("Nessuna prenotazione in questo giorno.")
        items.forEach { b ->
            Panel {
                BookingLine(s, b)
                Hint(b.status ?: "Attiva")
                if (b.status != "cancelled")
                    TextButton({ cancel = b }) { Text("Annulla prenotazione") }
            }
        }
    }
    cancel?.let { b ->
        AlertDialog(
            onDismissRequest = { cancel = null },
            title = { Text("Annullare la prenotazione?") },
            text = { Text("${b.user} · ${b.date} · ${b.time}") },
            confirmButton = {
                TextButton({
                    cancel = null
                    s.perform {
                        s.mutate("admin/reservations/${b.id}", "DELETE")
                        items = s.request<Items<Booking>>("admin/reservations?date=$day").items
                    }
                }) {
                    Text("Annulla prenotazione")
                }
            },
            dismissButton = { TextButton({ cancel = null }) { Text("Mantieni") } },
        )
    }
}

@Composable
fun Users(s: BeachStore) {
    var query by remember { mutableStateOf("") }
    var create by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<ManagedUser?>(null) }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var delta by remember { mutableStateOf("1") }
    var newName by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { s.perform { s.loadUsers() } }
    Page {
        Input("Cerca cliente", query, { query = it })
        Action("Crea cliente") { create = true }
        s.users
            .filter { it.username.contains(query, true) }
            .forEach { u ->
                Panel {
                    Text(u.username, fontWeight = FontWeight.Bold)
                    Hint(
                        "${u.credits} crediti · ${if(u.pendingApproval)"Da approvare"else if(u.disabled)"Disabilitato"else u.role}"
                    )
                    Action("Gestisci") {
                        selected = u
                        newName = u.username
                    }
                }
            }
    }
    if (create)
        AlertDialog(
            onDismissRequest = {
                create = false
                password = ""
            },
            title = { Text("Nuovo cliente") },
            text = {
                Column {
                    Input("Username", username, { username = it })
                    Input(
                        "Password · almeno 12 caratteri",
                        password,
                        { password = it },
                        password = true,
                    )
                    Hint("L’utente parte con zero crediti.")
                }
            },
            confirmButton = {
                TextButton(
                    {
                        s.perform {
                            s.mutate(
                                "admin/users",
                                body =
                                    payload(
                                        "username" to username,
                                        "password" to password,
                                        "credits" to 0,
                                        "role" to "user",
                                    ),
                            )
                            password = ""
                            create = false
                            s.loadUsers()
                        }
                    },
                    enabled = !s.busy && username.length >= 3 && password.length >= 12,
                ) {
                    Text("Crea")
                }
            },
            dismissButton = {
                TextButton({
                    create = false
                    password = ""
                }) {
                    Text("Annulla")
                }
            },
        )
    selected?.let { u ->
        AlertDialog(
            onDismissRequest = {
                selected = null
                password = ""
            },
            title = { Text(u.username) },
            text = {
                Column {
                    Text("${u.credits} crediti")
                    Input("Nuovo username", newName, { newName = it })
                    TextButton(
                        {
                            s.perform {
                                s.mutate(
                                    "admin/users/rename",
                                    body =
                                        payload(
                                            "oldUsername" to u.username,
                                            "newUsername" to newName,
                                        ),
                                )
                                s.loadUsers()
                                selected = null
                            }
                        },
                        enabled =
                            !s.busy &&
                                u.username != s.member?.username &&
                                Regex("^[A-Za-z0-9._-]{3,40}$").matches(newName) &&
                                newName != u.username,
                    ) {
                        Text("Rinomina")
                    }
                    Input(
                        "Nuova password · almeno 12 caratteri",
                        password,
                        { password = it },
                        password = true,
                    )
                    TextButton(
                        {
                            s.perform {
                                s.mutate(
                                    "admin/users/password",
                                    "PUT",
                                    payload("username" to u.username, "newPassword" to password),
                                )
                                password = ""
                                selected = null
                                s.message = "Password aggiornata."
                            }
                        },
                        enabled = password.length >= 12 && !s.busy,
                    ) {
                        Text("Reimposta password")
                    }
                    TextButton(
                        {
                            s.perform {
                                s.mutate(
                                    "admin/users/status",
                                    "PUT",
                                    payload(
                                        "username" to u.username,
                                        "disabled" to if (u.pendingApproval) false else !u.disabled,
                                    ),
                                )
                                s.loadUsers()
                                selected = null
                            }
                        },
                        enabled = u.username != s.member?.username && !s.busy,
                    ) {
                        Text(
                            if (u.disabled || u.pendingApproval) "Approva / abilita"
                            else "Disabilita"
                        )
                    }
                    if (s.member?.platformAdmin == true) {
                        Input("Rettifica crediti · variazione", delta, { delta = it })
                        TextButton(
                            {
                                s.perform {
                                    s.mutate(
                                        "admin/users/credits",
                                        "PUT",
                                        payload("username" to u.username, "delta" to delta.toInt()),
                                    )
                                    s.loadUsers()
                                    selected = null
                                }
                            },
                            enabled = delta.toIntOrNull() in -100..100 && delta != "0" && !s.busy,
                        ) {
                            Text("Applica rettifica")
                        }
                        TextButton(
                            {
                                s.perform {
                                    s.mutate(
                                        "admin/users/role",
                                        "PUT",
                                        payload(
                                            "username" to u.username,
                                            "role" to if (u.role == "admin") "user" else "admin",
                                        ),
                                    )
                                    s.loadUsers()
                                    selected = null
                                }
                            },
                            enabled = u.username != s.member?.username && !s.busy,
                        ) {
                            Text(if (u.role == "admin") "Imposta cliente" else "Imposta gestore")
                        }
                    } else Hint("In CampoPronto ADS il gestore non può assegnare crediti.")
                }
            },
            confirmButton = {
                TextButton({
                    selected = null
                    password = ""
                }) {
                    Text("Chiudi")
                }
            },
        )
    }
}

@Composable
fun Settings(s: BeachStore) {
    var start by remember { mutableStateOf(s.config.dayStart) }
    var end by remember { mutableStateOf(s.config.dayEnd) }
    var duration by remember { mutableStateOf(s.config.slotMinutes.toString()) }
    var daily by remember { mutableStateOf(s.config.maxBookingsPerUserPerDay.toString()) }
    var active by remember { mutableStateOf(s.config.maxActiveBookingsPerUser.toString()) }
    var registration by remember { mutableStateOf(s.config.registrationEnabled) }
    var fields by remember { mutableStateOf(s.config.fields) }
    var note by remember { mutableStateOf(s.config.notesText.orEmpty()) }
    var photos by remember { mutableStateOf(s.config.gallery) }
    Page {
        Panel("Orari e regole") {
            Input("Apertura HH:mm", start, { start = it })
            Input("Chiusura HH:mm", end, { end = it })
            Input("Durata minuti", duration, { duration = it }, numeric = true)
            Input("Prenotazioni al giorno", daily, { daily = it }, numeric = true)
            Input("Prenotazioni attive", active, { active = it }, numeric = true)
            Toggle("Consenti richieste di iscrizione", registration) { registration = it }
            Action(
                "Salva orari",
                !s.busy &&
                    Clock.validTime(start) &&
                    Clock.validTime(end) &&
                    duration.toIntOrNull() in 5..240 &&
                    Clock.minutes(end) - Clock.minutes(start) >= (duration.toIntOrNull() ?: 9999) &&
                    daily.toIntOrNull() in 1..50 &&
                    active.toIntOrNull() in 1..100,
            ) {
                s.perform {
                    s.mutate(
                        "admin/config",
                        "PUT",
                        payload(
                            "dayStart" to start,
                            "dayEnd" to end,
                            "slotMinutes" to duration.toInt(),
                            "maxBookingsPerUserPerDay" to daily.toInt(),
                            "maxActiveBookingsPerUser" to active.toInt(),
                            "registrationEnabled" to registration,
                        ),
                    )
                    s.refresh()
                    s.message = "Orari salvati."
                }
            }
        }
        Panel("Campi") {
            fields.forEachIndexed { i, f ->
                Input(
                    "Nome campo ${i+1}",
                    f.name,
                    { value ->
                        fields = fields.toMutableList().apply { set(i, f.copy(name = value)) }
                    },
                )
                TextButton({ fields = fields.filterIndexed { j, _ -> j != i } }) {
                    Text("Rimuovi campo")
                }
            }
            TextButton({
                fields = fields + Court("campo-${UUID.randomUUID()}", "Campo ${fields.size+1}")
            }) {
                Text("Aggiungi campo")
            }
            Hint("I campi con prenotazioni non possono essere rimossi.")
            Action(
                "Salva campi",
                fields.isNotEmpty() && fields.all { it.name.isNotBlank() } && !s.busy,
            ) {
                s.perform {
                    s.mutate(
                        "admin/fields",
                        "PUT",
                        payload("fields" to s.api.json.encodeToJsonElement(fields)),
                    )
                    s.refresh()
                    s.message = "Campi salvati."
                }
            }
        }
        Panel("Avvisi") {
            Input("Comunicazione agli utenti", note, { note = it })
            Action("Salva avviso", !s.busy) {
                s.perform {
                    s.mutate("admin/notes", "PUT", payload("text" to note))
                    s.refresh()
                    s.message = "Avviso salvato."
                }
            }
        }
        Panel("Foto stabilimento") {
            Gallery(photos)
            photos.forEachIndexed { i, p ->
                Input(
                    "URL foto HTTPS",
                    p.url,
                    { v -> photos = photos.toMutableList().apply { set(i, p.copy(url = v)) } },
                )
                Input(
                    "Didascalia",
                    p.caption.orEmpty(),
                    { v -> photos = photos.toMutableList().apply { set(i, p.copy(caption = v)) } },
                )
                Input(
                    "Link HTTPS facoltativo",
                    p.link.orEmpty(),
                    { v -> photos = photos.toMutableList().apply { set(i, p.copy(link = v)) } },
                )
                TextButton({ photos = photos.filterIndexed { j, _ -> j != i } }) {
                    Text("Rimuovi foto")
                }
            }
            TextButton({ photos = photos + Photo("") }, enabled = photos.size < 10) {
                Text("Aggiungi foto")
            }
            Hint("Usa immagini per cui hai diritti e consenso delle persone riconoscibili.")
            Action(
                "Salva foto",
                !s.busy &&
                    photos.all {
                        it.url.startsWith("https://") &&
                            (it.link.isNullOrBlank() || it.link.startsWith("https://"))
                    },
            ) {
                s.perform {
                    s.mutate(
                        "admin/gallery",
                        "PUT",
                        payload("images" to s.api.json.encodeToJsonElement(photos)),
                    )
                    s.refresh()
                    s.message = "Foto salvate."
                }
            }
        }
    }
}

@Composable
fun Closures(s: BeachStore) {
    var field by remember { mutableStateOf(s.config.fields.firstOrNull()?.id.orEmpty()) }
    var first by remember { mutableStateOf(Clock.today()) }
    var last by remember { mutableStateOf(Clock.today()) }
    var start by remember { mutableStateOf(s.config.dayStart) }
    var end by remember { mutableStateOf(s.config.dayEnd) }
    var reason by remember { mutableStateOf("Chiusura campo") }
    var closures by remember { mutableStateOf<List<Closure>>(emptyList()) }
    LaunchedEffect(Unit) {
        s.perform { closures = s.request<Operations>("admin/operations").closures }
    }
    Page {
        Panel("Blocca un periodo") {
            s.config.fields.forEach { f ->
                Row {
                    RadioButton(field == f.id, { field = f.id })
                    Text(f.name)
                }
            }
            DayButton("Da", first) { first = it }
            DayButton("Fino a", last) { last = it }
            Input("Ora inizio HH:mm", start, { start = it })
            Input("Ora fine HH:mm", end, { end = it })
            Input("Motivo", reason, { reason = it })
            Hint(
                "La data finale è inclusa. Le prenotazioni esistenti non vengono cancellate automaticamente."
            )
            Action(
                "Blocca campo",
                !s.busy &&
                    field.isNotBlank() &&
                    last >= first &&
                    Clock.validTime(start) &&
                    Clock.validTime(end) &&
                    Clock.minutes(end) > Clock.minutes(start) &&
                    reason.isNotBlank(),
            ) {
                s.perform {
                    s.mutate(
                        "admin/closures",
                        body =
                            payload(
                                "fieldId" to field,
                                "startDate" to first,
                                "endDate" to last,
                                "start" to start,
                                "end" to end,
                                "reason" to reason,
                            ),
                    )
                    closures = s.request<Operations>("admin/operations").closures
                    s.message = "Periodo bloccato."
                }
            }
        }
        closures.forEach { c ->
            Panel {
                s.config.fields.find { it.id == c.fieldId }?.let { Text(it.name) }
                Text("${c.startDate?:c.date} – ${c.endDate?:c.date} · ${c.start}–${c.end}")
                Hint(c.reason.orEmpty())
                TextButton({
                    s.perform {
                        s.mutate("admin/closures/${c.id}", "DELETE")
                        closures = s.request<Operations>("admin/operations").closures
                    }
                }) {
                    Text("Rimuovi chiusura")
                }
            }
        }
    }
}

@Composable
fun Reports(s: BeachStore) {
    var items by remember { mutableStateOf(JsonArray(emptyList())) }
    LaunchedEffect(Unit) {
        s.perform {
            items =
                s.requestRaw("admin/community-reports").jsonObject["items"]?.jsonArray
                    ?: JsonArray(emptyList())
        }
    }
    Page {
        if (items.isEmpty()) Hint("Nessuna segnalazione aperta.")
        items.forEach { r ->
            val o = r.jsonObject
            Panel(o["reportedUser"]?.jsonPrimitive?.content ?: "Segnalazione") {
                Text(o["reason"]?.jsonPrimitive?.content.orEmpty())
                listOf("close-search" to "Nascondi ricerca", "resolve" to "Risolvi").forEach {
                    (action, label) ->
                    TextButton({
                        s.perform {
                            s.mutate(
                                "admin/community-reports/${o["id"]?.jsonPrimitive?.content}",
                                "PATCH",
                                payload("action" to action),
                            )
                            items =
                                s.requestRaw("admin/community-reports")
                                    .jsonObject["items"]
                                    ?.jsonArray ?: JsonArray(emptyList())
                        }
                    }) {
                        Text(label)
                    }
                }
            }
        }
    }
}

@Composable
fun Recovery(s: BeachStore) {
    var items by remember { mutableStateOf(JsonArray(emptyList())) }
    var password by remember { mutableStateOf("") }
    LaunchedEffect(Unit) {
        s.perform {
            items =
                s.requestRaw("auth/admin/recovery-requests").jsonObject["items"]?.jsonArray
                    ?: JsonArray(emptyList())
        }
    }
    Page {
        Hint(
            "Verifica l’identità del cliente prima di reimpostare la password. Comunica le nuove credenziali in modo sicuro."
        )
        if (items.isEmpty()) Hint("Nessuna richiesta in attesa.")
        items.forEach { r ->
            val user = r.jsonObject["username"]?.jsonPrimitive?.content.orEmpty()
            Panel(user) {
                Input(
                    "Nuova password · almeno 12 caratteri",
                    password,
                    { password = it },
                    password = true,
                )
                Action("Reimposta password", password.length >= 12 && !s.busy) {
                    s.perform {
                        s.mutate(
                            "admin/users/password",
                            "PUT",
                            payload("username" to user, "newPassword" to password),
                        )
                        password = ""
                        items =
                            s.requestRaw("auth/admin/recovery-requests")
                                .jsonObject["items"]
                                ?.jsonArray ?: JsonArray(emptyList())
                        s.message = "Password aggiornata."
                    }
                }
            }
        }
    }
}

@Composable
fun Platform(s: BeachStore, onDone: () -> Unit) {
    var items by remember { mutableStateOf<List<Venue>>(emptyList()) }
    var selected by remember { mutableStateOf<Venue?>(null) }
    var name by remember { mutableStateOf("") }
    var city by remember { mutableStateOf("") }
    var latitude by remember { mutableStateOf("") }
    var longitude by remember { mutableStateOf("") }
    var visible by remember { mutableStateOf(false) }
    var enabled by remember { mutableStateOf(true) }
    var create by remember { mutableStateOf(false) }
    var id by remember { mutableStateOf("") }
    var user by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    LaunchedEffect(Unit) {
        s.perform { items = s.request<Items<Venue>>("platform/establishments").items }
    }
    Page {
        Action("Crea stabilimento e gestore") {
            create = true
            name = ""
        }
        items.forEach { v ->
            Panel(v.name) {
                Hint(if (v.visibility == "public") "Visibile nella ricerca" else "Privato")
                Action("Impostazioni") {
                    selected = v
                    name = v.name
                    city = v.city.orEmpty()
                    latitude = v.latitude?.toString().orEmpty()
                    longitude = v.longitude?.toString().orEmpty()
                    visible = v.visibility == "public"
                    enabled = v.enabled != false
                }
                Action("Gestisci questo stabilimento", v.enabled != false) {
                    s.switchVenue(v)
                    onDone()
                }
                ShareInvitation("campopronto://venue?id=${v.id}")
            }
        }
    }
    if (create)
        AlertDialog(
            onDismissRequest = {
                create = false
                password = ""
            },
            title = { Text("Nuovo stabilimento") },
            text = {
                Column {
                    Input("Nome", name, { name = it })
                    Input("Identificativo es. lido-sole", id, { id = it })
                    Input("Username gestore", user, { user = it })
                    Input(
                        "Password gestore · almeno 12 caratteri",
                        password,
                        { password = it },
                        password = true,
                    )
                    Hint("Nasce privato. Il gestore accede solo ai propri dati.")
                }
            },
            confirmButton = {
                TextButton(
                    {
                        s.perform {
                            s.mutate(
                                "platform/establishments",
                                body =
                                    payload(
                                        "id" to id,
                                        "name" to name,
                                        "managerUsername" to user,
                                        "managerPassword" to password,
                                    ),
                            )
                            password = ""
                            create = false
                            items = s.request<Items<Venue>>("platform/establishments").items
                        }
                    },
                    enabled =
                        name.isNotBlank() &&
                            id.isNotBlank() &&
                            user.isNotBlank() &&
                            password.length >= 12 &&
                            !s.busy,
                ) {
                    Text("Crea")
                }
            },
            dismissButton = {
                TextButton({
                    create = false
                    password = ""
                }) {
                    Text("Annulla")
                }
            },
        )
    selected?.let { v ->
        AlertDialog(
            onDismissRequest = { selected = null },
            title = { Text(v.name) },
            text = {
                Column {
                    Input("Nome", name, { name = it })
                    Input("Città", city, { city = it })
                    Input("Latitudine facoltativa", latitude, { latitude = it })
                    Input("Longitudine facoltativa", longitude, { longitude = it })
                    Toggle("Visibile nella ricerca", visible) { visible = it }
                    if (v.id != "tommi38") Toggle("Stabilimento attivo", enabled) { enabled = it }
                }
            },
            confirmButton = {
                TextButton(
                    {
                        s.perform {
                            val lat = latitude.replace(',', '.').toDoubleOrNull()
                            val lon = longitude.replace(',', '.').toDoubleOrNull()
                            if (
                                (latitude.isNotBlank() || longitude.isNotBlank()) &&
                                    (lat == null ||
                                        lon == null ||
                                        lat !in -90.0..90.0 ||
                                        lon !in -180.0..180.0)
                            )
                                throw ApiException("COORDINATE_NON_VALIDE")
                            s.mutate(
                                "platform/establishments/${v.id}",
                                "PATCH",
                                payload(
                                    "name" to name,
                                    "city" to city,
                                    "visibility" to if (visible) "public" else "private",
                                    "enabled" to enabled,
                                    "latitude" to lat,
                                    "longitude" to lon,
                                ),
                            )
                            items = s.request<Items<Venue>>("platform/establishments").items
                            selected = null
                        }
                    },
                    enabled = name.isNotBlank() && !s.busy,
                ) {
                    Text("Salva")
                }
            },
            dismissButton = { TextButton({ selected = null }) { Text("Annulla") } },
        )
    }
}

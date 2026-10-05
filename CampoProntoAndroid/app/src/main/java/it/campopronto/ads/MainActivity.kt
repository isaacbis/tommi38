package it.campopronto.ads

import android.Manifest
import android.app.DatePickerDialog
import android.content.*
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.Uri
import android.os.*
import androidx.activity.*
import androidx.activity.compose.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.animation.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.*
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.*
import androidx.compose.ui.unit.*
import androidx.core.content.ContextCompat
import coil.compose.AsyncImage
import java.time.LocalDate
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

class MainActivity : ComponentActivity() {
    private val store: BeachStore by viewModels()
    private lateinit var ads: NativeAds

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        ads = NativeAds(this)
        intent.data?.let { store.invite(it.getQueryParameter("id")) }
        setContent {
            MaterialTheme(
                colorScheme =
                    lightColorScheme(
                        primary = Color(0xff157ecb),
                        secondary = Color(0xff168f9e),
                        background = Color(0xfff2f8fc),
                        surface = Color.White,
                    )
            ) {
                CampoApp(store, ads)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.data?.let { store.invite(it.getQueryParameter("id")) }
    }
}

@Composable
fun Page(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
    )
}

@Composable
fun Panel(title: String? = null, content: @Composable ColumnScope.() -> Unit) {
    Card(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(22.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            title?.let { Text(it, fontWeight = FontWeight.SemiBold) }
            content()
        }
    }
}

@Composable
fun Hint(text: String) {
    Text(text, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
fun Input(
    label: String,
    value: String,
    change: (String) -> Unit,
    password: Boolean = false,
    numeric: Boolean = false,
) {
    OutlinedTextField(
        value,
        change,
        label = { Text(label) },
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
        shape = RoundedCornerShape(14.dp),
        visualTransformation =
            if (password) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions =
            KeyboardOptions(
                keyboardType =
                    if (password) KeyboardType.Password
                    else if (numeric) KeyboardType.Number else KeyboardType.Text,
                autoCorrectEnabled = false,
            ),
    )
}

@Composable
fun Action(text: String, enabled: Boolean = true, onClick: () -> Unit) {
    Button(
        onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
    ) {
        Text(text)
    }
}

@Composable
fun Toggle(label: String, value: Boolean, change: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        Switch(value, change)
    }
}

@Composable
fun DayButton(label: String, value: String, change: (String) -> Unit) {
    val context = LocalContext.current
    OutlinedButton(
        onClick = {
            val d = runCatching { LocalDate.parse(value) }.getOrDefault(LocalDate.now(Clock.zone))
            DatePickerDialog(
                    context,
                    { _, y, m, day -> change(LocalDate.of(y, m + 1, day).toString()) },
                    d.year,
                    d.monthValue - 1,
                    d.dayOfMonth,
                )
                .show()
        },
        modifier = Modifier.fillMaxWidth(),
    ) {
        Icon(Icons.Default.CalendarMonth, null)
        Spacer(Modifier.width(8.dp))
        Text("$label · $value")
    }
}

@Composable
fun LinkButton(label: String, url: String) {
    val context = LocalContext.current
    TextButton({ context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }) {
        Text(label)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CampoApp(s: BeachStore, ads: NativeAds) {
    var route by remember {
        mutableStateOf(if (s.registrationResult != null) "registration" else "entry")
    }
    var managerArea by remember { mutableStateOf(false) }
    var tab by remember { mutableStateOf("Home") }
    var bannerReady by remember { mutableStateOf(false) }
    var entering by remember { mutableStateOf(false) }
    val context = LocalActivity.current as MainActivity
    val scope = rememberCoroutineScope()
    BackHandler(enabled = s.member == null && (s.selected != null || route != "entry")) {
        if (s.registrationResult != null) {
            s.message = "Salva il PDF delle credenziali prima di uscire."
        } else if (!s.busy) {
            if (s.selected != null) s.back()
            else if (route == "venues") route = "entry" else route = "venues"
        }
    }
    LaunchedEffect(s.member?.username, s.member?.demo, s.selected?.id) {
        bannerReady = false
        if (s.member != null && s.member?.isManager != true && s.member?.demo != true) {
            try {
                val status = s.request<AdsStatus>("ads/status")
                if (status.available) {
                    entering = s.loginAdPending
                    s.loginAdPending = false
                    withTimeout(20_000) {
                        ads.prepare()
                        bannerReady = true
                        if (entering)
                            ads.login {
                                s.member != null && s.member?.isManager != true && tab == "Home"
                            }
                    }
                }
            } catch (_: Exception) {} finally {
                entering = false
            }
        }
    }
    LaunchedEffect(s.member?.username) {
        if (s.member != null) route = "entry"
        if (s.member == null) {
            tab = "Home"
            bannerReady = false
        }
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        if (s.member != null) s.selected?.name ?: "CampoPronto ADS"
                        else if (s.selected != null) s.selected!!.name
                        else if (route == "registration") "Registra stabilimento"
                        else if (route == "demo") "Prova la demo" else "CampoPronto ADS",
                        maxLines = 1,
                        fontSize = 20.sp,
                    )
                },
                navigationIcon = {
                    if (
                        (s.member == null && (s.selected != null || route != "entry")) ||
                            s.member != null && route != "entry"
                    )
                        IconButton({
                            if (s.registrationResult != null) {
                                s.message = "Salva il PDF delle credenziali prima di uscire."
                            } else if (!s.busy) {
                                if (s.member != null) route = "entry"
                                else if (s.selected != null) s.back()
                                else route = if (route == "venues") "entry" else "venues"
                            }
                        }) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, "Indietro")
                        }
                },
                actions = {
                    if (s.member != null) {
                        if (s.member?.demo == true)
                            TextButton({ s.demoRole() }) {
                                Text(
                                    if (s.member?.isManager == true) "Prova cliente"
                                    else "Prova gestore"
                                )
                            }
                        IconButton({ route = "account" }) {
                            Icon(Icons.Default.AccountCircle, "Account")
                        }
                    }
                },
            )
        },
        bottomBar = {
            if (s.member != null && route == "entry") {
                NavigationBar {
                    val tabs =
                        if (s.member?.isManager == true) listOf("Home", "Prenota", "Gestione")
                        else listOf("Home", "Prenota", "Le mie", "Crediti", "Giocatori")
                    tabs.forEach { label ->
                        NavigationBarItem(
                            selected = tab == label,
                            onClick = { tab = label },
                            icon = {
                                Icon(
                                    when (label) {
                                        "Home" -> Icons.Default.Home
                                        "Prenota" -> Icons.Default.CalendarMonth
                                        "Le mie" -> Icons.Default.EventAvailable
                                        "Crediti" -> Icons.Default.PlayCircle
                                        "Gestione" -> Icons.Default.Settings
                                        else -> Icons.Default.Groups
                                    },
                                    null,
                                )
                            },
                            label = { Text(label, fontSize = 11.sp) },
                        )
                    }
                }
            }
        },
    ) { insets ->
        Box(
            Modifier.fillMaxSize()
                .padding(insets)
                .background(Brush.verticalGradient(listOf(Color(0xffe9f7fc), Color(0xfff4f7fc))))
        ) {
            if (s.loading) CircularProgressIndicator(Modifier.align(Alignment.Center))
            else if (s.member != null) {
                Column {
                    ClientBanner(context, ads, bannerReady)
                    if (route == "account") AccountScreen(s, ads) { route = "entry" }
                    else if (route.startsWith("manage:"))
                        ManagementDetail(s, route.substringAfter(':')) { route = "entry" }
                    else
                        AnimatedContent(tab, label = "tabs") { current ->
                            when (current) {
                                "Home" -> HomeScreen(s) { tab = it }
                                "Prenota" -> BookingScreen(s)
                                "Le mie" -> MyBookings(s)
                                "Crediti" -> CreditsScreen(s, ads)
                                "Giocatori" -> CommunityScreen(s)
                                else -> ManagementMenu(s) { route = "manage:$it" }
                            }
                        }
                }
            } else if (s.selected != null) LoginScreen(s)
            else
                when (route) {
                    "entry" ->
                        EntryScreen(
                            {
                                managerArea = false
                                route = "venues"
                            },
                            {
                                managerArea = true
                                route = "venues"
                            },
                        )
                    "registration" -> RegistrationScreen(s) { route = "venues" }
                    "demo" -> SetupScreen(s, false) {}
                    else ->
                        VenueScreen(s, managerArea, { route = "registration" }, { route = "demo" })
                }
            if (s.busy || entering) {
                LinearProgressIndicator(Modifier.fillMaxWidth().align(Alignment.TopCenter))
            }
            if (entering)
                Surface(
                    Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.surface.copy(alpha = .96f),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(14.dp),
                        ) {
                            CircularProgressIndicator()
                            Text("Accesso in corso…")
                        }
                    }
                }
        }
    }
    s.message?.let { message ->
        AlertDialog(
            onDismissRequest = { s.message = null },
            title = { Text("CampoPronto ADS") },
            text = { Text(message) },
            confirmButton = { TextButton({ s.message = null }) { Text("OK") } },
        )
    }
}

@Composable
fun EntryScreen(client: () -> Unit, manager: () -> Unit) {
    Page {
        Image(
            painterResource(R.drawable.entry_logo),
            "CampoPronto ADS",
            Modifier.size(142.dp).align(Alignment.CenterHorizontally),
            contentScale = ContentScale.Fit,
        )
        Text("Il tuo campo, pronto per giocare", fontSize = 26.sp, fontWeight = FontWeight.Bold)
        Hint("Scegli come vuoi entrare")
        Panel("Sono un cliente") {
            Text("Trova lo stabilimento e prenota il tuo campo.")
            Action("Cerca il tuo stabilimento", onClick = client)
        }
        Panel("Sono un gestore") {
            Text("Gestisci il tuo stabilimento, registralo o prova una demo.")
            Action("Accedi o prova come gestore", onClick = manager)
        }
    }
}

@Composable
fun VenueScreen(s: BeachStore, manager: Boolean, register: () -> Unit, demo: () -> Unit) {
    var query by remember { mutableStateOf("") }
    var nearby by remember { mutableStateOf<Pair<Double, Double>?>(null) }
    val context = LocalContext.current
    fun location() {
        if (
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            ) != PackageManager.PERMISSION_GRANTED
        )
            return
        val lm = context.getSystemService(LocationManager::class.java)
        try {
            val known = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
            if (
                Build.VERSION.SDK_INT >= 30 &&
                    lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
            ) {
                lm.getCurrentLocation(
                    LocationManager.NETWORK_PROVIDER,
                    null,
                    context.mainExecutor,
                ) { loc ->
                    if (loc != null) nearby = loc.latitude to loc.longitude
                    else s.message = "Posizione non disponibile. Cerca per nome o città."
                }
            } else if (known != null) nearby = known.latitude to known.longitude
            else s.message = "Posizione non disponibile. Cerca per nome o città."
        } catch (_: Exception) {
            s.message = "Posizione non disponibile. Cerca per nome o città."
        }
    }
    val permission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
            if (it) location() else s.message = "Puoi cercare lo stabilimento per nome o città."
        }
    Page {
        if (manager) {
            Panel {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(register, Modifier.weight(1f)) { Text("Registra") }
                    Button(demo, Modifier.weight(1f)) { Text("Prova 10 min") }
                }
            }
        }
        Text(
            if (manager) "Il tuo stabilimento" else "Dove vuoi giocare?",
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
        )
        Input("Cerca nome o città", query, { query = it })
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton({
                if (
                    ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.ACCESS_COARSE_LOCATION,
                    ) == PackageManager.PERMISSION_GRANTED
                )
                    location()
                else permission.launch(Manifest.permission.ACCESS_COARSE_LOCATION)
            }) {
                Icon(Icons.Default.NearMe, null)
                Text("Vicino a me")
            }
            TextButton({
                nearby = null
                s.perform { s.loadVenues() }
            }) {
                Text("Aggiorna")
            }
        }
        val filtered =
            s.venues
                .filter {
                    query.isBlank() || "${it.name} ${it.city.orEmpty()}".contains(query, true)
                }
                .let { list ->
                    nearby?.let { p -> list.sortedBy { Clock.distance(p.first, p.second, it) } }
                        ?: list
                }
        if (filtered.isEmpty()) Hint("Nessuno stabilimento trovato. Prova un altro nome.")
        filtered.forEach { v ->
            Card(
                onClick = { s.choose(v) },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(20.dp),
            ) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Image(
                        painterResource(R.drawable.app_icon),
                        null,
                        Modifier.size(48.dp).clip(RoundedCornerShape(14.dp)),
                    )
                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                        Text(v.name, fontWeight = FontWeight.Bold)
                        Hint(v.city ?: "Accedi con le credenziali dello stabilimento")
                        nearby?.let { p ->
                            val d = Clock.distance(p.first, p.second, v)
                            if (d != Double.MAX_VALUE) Hint("%.1f km".format(d))
                        }
                    }
                    Icon(Icons.Default.ChevronRight, null)
                }
            }
        }
        Hint("La posizione viene usata solo sul telefono per ordinare i risultati.")
    }
}

@Composable
fun Gallery(photos: List<Photo>) {
    if (photos.isNotEmpty()) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            photos.chunked(5).forEach { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    row.forEach { photo ->
                        Column(
                            Modifier.weight(1f),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            AsyncImage(
                                photo.url,
                                photo.caption ?: "Foto dello stabilimento",
                                modifier =
                                    Modifier.fillMaxWidth()
                                        .aspectRatio(1f)
                                        .clip(RoundedCornerShape(18.dp))
                                        .background(Color(0xffeaf3f9)),
                                contentScale = ContentScale.Fit,
                            )
                            photo.caption
                                ?.takeIf { it.isNotBlank() }
                                ?.let { Text(it, fontSize = 10.sp, maxLines = 2) }
                        }
                    }
                    repeat(5 - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

@Composable
fun LoginScreen(s: BeachStore) {
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var registering by remember { mutableStateOf(false) }
    Page {
        Gallery(s.config.gallery)
        Panel(if (registering) "Richiedi un account" else "Bentornato") {
            Hint("Accedi a ${s.selected?.name} con username e password.")
            Input("Nome utente", username, { username = it })
            Input("Password", password, { password = it }, password = true)
            Action(
                if (registering) "Richiedi iscrizione" else "Accedi",
                !s.busy && username.length >= 3 && password.isNotEmpty(),
            ) {
                if (registering)
                    s.perform {
                        s.mutate(
                            "auth/register",
                            body = payload("username" to username, "password" to password),
                        )
                        password = ""
                        registering = false
                        s.message = "Richiesta inviata. Il gestore deve approvare l’account."
                    }
                else {
                    s.login(username, password)
                    password = ""
                }
            }
            if (s.config.registrationEnabled)
                TextButton({ registering = !registering }) {
                    Text(if (registering) "Ho già un account" else "Crea un account")
                }
            TextButton(
                {
                    s.perform {
                        s.mutate("auth/recovery-request", body = payload("username" to username))
                        s.message =
                            "Se l’account esiste, la richiesta è stata inviata al gestore. Contattalo per il recupero."
                    }
                },
                enabled = username.length >= 3 && !s.busy,
            ) {
                Text("Recupera password")
            }
        }
        Hint("Le credenziali sono fornite dal tuo stabilimento.")
    }
}

@Composable
fun SetupFields(
    name: String,
    onName: (String) -> Unit,
    fields: List<String>,
    onFields: (List<String>) -> Unit,
    start: String,
    onStart: (String) -> Unit,
    end: String,
    onEnd: (String) -> Unit,
    duration: String,
    onDuration: (String) -> Unit,
) {
    Panel("Stabilimento e campi") {
        Input("Nome stabilimento", name, onName)
        fields.forEachIndexed { i, value ->
            Input(
                "Campo ${i+1}",
                value,
                { new -> onFields(fields.toMutableList().apply { set(i, new) }) },
            )
        }
        Row {
            TextButton({ onFields(fields + "Campo ${fields.size+1}") }, enabled = fields.size < 6) {
                Text("Aggiungi campo")
            }
            TextButton({ onFields(fields.dropLast(1)) }, enabled = fields.size > 1) {
                Text("Rimuovi ultimo")
            }
        }
    }
    Panel("Orari di prenotazione") {
        Input("Apertura HH:mm", start, onStart)
        Input("Chiusura HH:mm", end, onEnd)
        Input("Durata minuti", duration, onDuration, numeric = true)
    }
}

@Composable
fun SetupScreen(s: BeachStore, registration: Boolean, onDone: () -> Unit) {
    var name by remember { mutableStateOf("La tua demo") }
    var fields by remember { mutableStateOf(listOf("Beach volley", "Tennis", "Padel")) }
    var start by remember { mutableStateOf("08:00") }
    var end by remember { mutableStateOf("23:00") }
    var duration by remember { mutableStateOf("40") }
    Page {
        Hint(
            "La demo privata dura 10 minuti. Puoi cambiare tra gestore e cliente, senza pubblicità o pagamenti."
        )
        SetupFields(
            name,
            { name = it },
            fields,
            { fields = it },
            start,
            { start = it },
            end,
            { end = it },
            duration,
            { duration = it },
        )
        Action("Avvia la mia demo", !s.busy && setupValid(name, fields, start, end, duration)) {
            s.demo(
                payload(
                    "name" to name,
                    "fields" to fields,
                    "dayStart" to start,
                    "dayEnd" to end,
                    "slotMinutes" to duration.toInt(),
                )
            )
        }
        OutlinedButton({ s.demo(null) }, Modifier.fillMaxWidth(), enabled = !s.busy) {
            Text("Salta · usa impostazioni di base")
        }
    }
}

fun setupValid(name: String, fields: List<String>, start: String, end: String, duration: String) =
    name.trim().length >= 2 &&
        fields.isNotEmpty() &&
        fields.all { it.isNotBlank() } &&
        fields.map { it.trim().lowercase() }.distinct().size == fields.size &&
        Clock.validTime(start) &&
        Clock.validTime(end) &&
        duration.toIntOrNull() in 5..240 &&
        Clock.minutes(end) - Clock.minutes(start) >= (duration.toIntOrNull() ?: 9999)

@Composable
fun RegistrationScreen(s: BeachStore, onDone: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var city by remember { mutableStateOf("") }
    var fields by remember { mutableStateOf(listOf("Beach volley", "Tennis", "Padel")) }
    var start by remember { mutableStateOf("08:00") }
    var end by remember { mutableStateOf("23:00") }
    var duration by remember { mutableStateOf("40") }
    var manager by remember { mutableStateOf("gestore") }
    var password by remember { mutableStateOf("") }
    var count by remember { mutableStateOf("10") }
    var prefix by remember { mutableStateOf("user") }
    val requestId = s.registrationRequestId
    val result = s.registrationResult
    val saved = s.registrationPdfSaved
    val context = LocalContext.current
    val pdf =
        rememberLauncherForActivityResult(
            ActivityResultContracts.CreateDocument("application/pdf")
        ) { uri ->
            if (uri != null)
                result?.let { r ->
                    s.perform {
                        RegistrationPdf.save(context, uri, r)
                        s.registrationPdfSaved = true
                        s.message =
                            "PDF salvato. Conserva il documento e consegna a ciascun cliente solo le sue credenziali."
                    }
                }
        }
    BackHandler(result != null) {
        s.message = "Salva il PDF prima di chiudere. Le password vengono mostrate solo una volta."
    }
    Page {
        val r = result
        if (r != null) {
            Panel("Stabilimento creato") {
                Text(r.name, fontWeight = FontWeight.Bold)
                Text("${r.credentials.size} clienti numerati, tutti con zero crediti.")
                Hint("Il tuo stabilimento è già attivo e visibile nella ricerca.")
                Text("Gestore: ${r.manager.username}")
                Hint(
                    "Salva il PDF prima di uscire. Contiene le password degli utenti e del gestore."
                )
                Action("Salva PDF delle credenziali") { pdf.launch("CampoPronto-credenziali.pdf") }
                Action("Ho salvato il PDF · Accedi", saved && !s.busy) {
                    s.choose(Venue(r.establishmentId, r.name, city))
                    s.registrationResult = null
                    s.registrationPdfSaved = false
                    onDone()
                }
            }
        } else {
            SetupFields(
                name,
                { name = it },
                fields,
                { fields = it },
                start,
                { start = it },
                end,
                { end = it },
                duration,
                { duration = it },
            )
            Input("Città", city, { city = it })
            Panel("Account gestore") {
                Input("Username gestore", manager, { manager = it })
                Input(
                    "Password · almeno 12 caratteri",
                    password,
                    { password = it },
                    password = true,
                )
            }
            Panel("Clienti") {
                Input("Numero clienti · 1–1000", count, { count = it }, numeric = true)
                Input("Prefisso utenti", prefix, { prefix = it })
                Hint(
                    "Utenti numerati da ${prefix}001. Password casuali alfanumeriche di 6 caratteri. Tutti partono con zero crediti."
                )
            }
            Hint("Stabilimento attivo subito. Il gestore vede e gestisce soltanto i propri dati.")
            val valid =
                setupValid(name, fields, start, end, duration) &&
                    Clock.countValid(count) &&
                    Regex("^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$").matches(manager) &&
                    password.length >= 12 &&
                    password.toByteArray().size <= 72 &&
                    Regex("^[A-Za-z][A-Za-z0-9_-]{0,19}$").matches(prefix) &&
                    (1..(count.toIntOrNull() ?: 0)).none { prefix + "%03d".format(it) == manager }
            Action(
                if (s.busy) "Creo stabilimento e clienti…" else "Crea stabilimento e PDF",
                valid && !s.busy,
            ) {
                s.perform {
                    val response =
                        s.request<RegistrationResult>(
                            "venue-registration",
                            "POST",
                            payload(
                                "requestId" to requestId,
                                "name" to name,
                                "city" to city,
                                "managerUsername" to manager,
                                "managerPassword" to password,
                                "fields" to fields,
                                "dayStart" to start,
                                "dayEnd" to end,
                                "slotMinutes" to duration.toInt(),
                                "userCount" to count.toInt(),
                                "userPrefix" to prefix,
                            ),
                        )
                    s.registrationResult = response
                    password = ""
                    if (s.venues.none { it.id == response.establishmentId })
                        s.venues = s.venues + Venue(response.establishmentId, response.name, city)
                }
            }
        }
    }
}

@Composable
fun HomeScreen(s: BeachStore, select: (String) -> Unit) {
    LaunchedEffect(s.selected?.id) { runCatching { s.weather = s.request("weather") } }
    Page {
        Gallery(s.config.gallery)
        Panel("Ciao, ${s.member?.username}") {
            Text(
                if (s.member?.isManager == true) "Il tuo stabilimento, sotto controllo."
                else "Pronto per la prossima partita?",
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
            )
            if (s.member?.isManager != true) {
                Text("${s.member?.credits?:0} crediti · 1 credito = 1 prenotazione")
                Action("Prenota un campo") { select("Prenota") }
                OutlinedButton({ select("Crediti") }, Modifier.fillMaxWidth()) {
                    Text("Ottieni un credito")
                }
            } else {
                Action("Gestisci stabilimento") { select("Gestione") }
            }
        }
        s.config.notesText?.takeIf { it.isNotBlank() }?.let { Panel("Avvisi") { Text(it) } }
        s.weather?.daily?.let { w ->
            Panel("Meteo · prossimi 3 giorni") {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    repeat(
                        minOf(
                            3,
                            w.time.size,
                            w.weathercode.size,
                            w.temperature_2m_max.size,
                            w.temperature_2m_min.size,
                        )
                    ) { i ->
                        Column(
                            Modifier.weight(1f),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text(
                                if (i == 0) "Oggi" else if (i == 1) "Domani" else "Dopodomani",
                                fontSize = 12.sp,
                            )
                            Text(weatherEmoji(w.weathercode[i]), fontSize = 30.sp)
                            Text(
                                "${w.temperature_2m_min[i].toInt()}° / ${w.temperature_2m_max[i].toInt()}°",
                                fontSize = 12.sp,
                            )
                        }
                    }
                }
            }
        }
        s.mine
            .filter { it.status != "cancelled" && !Clock.past(it.date, it.time) }
            .minByOrNull { it.date + it.time }
            ?.let {
                Panel("La tua prossima partita") {
                    BookingLine(s, it)
                    TextButton({ select("Le mie") }) { Text("Le mie prenotazioni") }
                }
            }
        TextButton({ s.perform { s.refresh() } }) { Text("Aggiorna dati") }
    }
}

fun weatherEmoji(code: Int) =
    when (code) {
        0 -> "☀️"
        1,
        2 -> "🌤️"
        3 -> "☁️"
        45,
        48 -> "🌫️"
        in 51..67 -> "🌧️"
        in 71..77 -> "❄️"
        in 80..86 -> "🌦️"
        in 95..99 -> "⛈️"
        else -> "🌤️"
    }

@Composable
fun BookingLine(s: BeachStore, b: Booking) {
    Column {
        Text(
            s.config.fields.find { it.id == b.fieldId }?.name ?: b.fieldId,
            fontWeight = FontWeight.SemiBold,
        )
        Hint("${b.date} · ${b.time}")
        if (s.member?.isManager == true) b.user?.let { Hint(it) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BookingScreen(s: BeachStore) {
    var field by
        remember(s.config.fields) { mutableStateOf(s.config.fields.firstOrNull()?.id ?: "") }
    var choice by remember { mutableStateOf<String?>(null) }
    var occupied by remember { mutableStateOf<Booking?>(null) }
    var username by remember { mutableStateOf("") }
    LaunchedEffect(s.day, s.selected?.id) {
        s.perform {
            s.loadDay()
            if (s.member?.isManager == true) s.loadUsers()
        }
    }
    Page {
        DayButton("Giorno", s.day) {
            if (!s.busy) {
                s.day = it
                s.bookings = emptyList()
                s.closures = emptyList()
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            s.config.fields.forEach { f ->
                FilterChip(field == f.id, { field = f.id }, label = { Text(f.name) })
            }
        }
        if (s.member?.isManager == true)
            Panel("Prenota per un cliente") {
                Input("Username cliente", username, { username = it })
                Hint(
                    "Il credito viene scalato al cliente. Le regole dello stabilimento restano valide."
                )
            }
        Panel("Orari disponibili") {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Clock.slots(s.config).forEach { time ->
                    val booking =
                        s.bookings.find {
                            it.overlaps(
                                s.day,
                                field,
                                time,
                                s.config.slotMinutes,
                                s.config.slotMinutes,
                            )
                        }
                    val closed =
                        s.closures.any {
                            (it.fieldId == field || it.fieldId == "*") &&
                                it.contains(s.day, time, s.config.slotMinutes)
                        }
                    OutlinedButton(
                        { if (booking != null) occupied = booking else choice = time },
                        enabled = !s.busy && !closed && !Clock.past(s.day, time),
                        contentPadding = PaddingValues(8.dp),
                        modifier = Modifier.height(40.dp),
                    ) {
                        Text(
                            time,
                            fontSize = 12.sp,
                            color =
                                if (booking == null && !closed && !Clock.past(s.day, time))
                                    MaterialTheme.colorScheme.primary
                                else Color.Gray,
                        )
                    }
                }
            }
            Hint("Gli orari grigi sono occupati o non disponibili.")
        }
        if (s.config.fields.isEmpty()) Hint("Il gestore deve configurare i campi.")
        TextButton({ s.perform { s.loadDay() } }) { Text("Aggiorna disponibilità") }
    }
    choice?.let { time ->
        AlertDialog(
            onDismissRequest = { choice = null },
            title = { Text("Conferma prenotazione") },
            text = {
                Text("${s.config.fields.find{it.id==field}?.name}\n${s.day} · $time\n1 credito")
            },
            confirmButton = {
                TextButton(
                    {
                        choice = null
                        s.perform {
                            s.mutate(
                                if (s.member?.isManager == true) "admin/reservations"
                                else "reservations",
                                body =
                                    if (s.member?.isManager == true)
                                        payload(
                                            "username" to username,
                                            "fieldId" to field,
                                            "date" to s.day,
                                            "time" to time,
                                        )
                                    else
                                        payload("fieldId" to field, "date" to s.day, "time" to time),
                            )
                            s.refresh()
                            s.message = "Prenotazione confermata."
                        }
                    },
                    enabled = s.member?.isManager != true || username.isNotBlank(),
                ) {
                    Text("Prenota")
                }
            },
            dismissButton = { TextButton({ choice = null }) { Text("Indietro") } },
        )
    }
    occupied?.let { b ->
        AlertDialog(
            onDismissRequest = { occupied = null },
            title = { Text("Orario occupato") },
            text = {
                Column {
                    BookingLine(s, b)
                    Hint(
                        "Puoi entrare nella lista d’attesa e controllare la disponibilità nella sezione Giocatori."
                    )
                }
            },
            confirmButton = {
                if (s.member?.managementMode != true && b.user != s.member?.username)
                    TextButton({
                        occupied = null
                        s.perform {
                            s.mutate("waitlist", body = payload("reservationId" to b.id))
                            s.message = "Sei in lista d’attesa."
                        }
                    }) {
                        Text("Avvisami se si libera")
                    }
            },
            dismissButton = { TextButton({ occupied = null }) { Text("Chiudi") } },
        )
    }
}

@Composable
fun MyBookings(s: BeachStore) {
    var cancel by remember { mutableStateOf<Booking?>(null) }
    var createSearch by remember { mutableStateOf<Booking?>(null) }
    var count by remember { mutableStateOf("2") }
    var note by remember { mutableStateOf("") }
    Page {
        Text("Le mie prenotazioni", fontSize = 24.sp, fontWeight = FontWeight.Bold)
        if (s.mine.isEmpty()) Hint("Non hai ancora prenotazioni.")
        s.mine
            .sortedBy { it.date + it.time }
            .forEach { b ->
                Panel {
                    BookingLine(s, b)
                    if (b.status != "cancelled" && !Clock.past(b.date, b.time)) {
                        Row {
                            TextButton({ createSearch = b }) { Text("Cerco giocatori") }
                            TextButton({ cancel = b }) { Text("Annulla") }
                        }
                    } else Hint(b.status ?: "Terminata")
                }
            }
        TextButton({ s.perform { s.refresh() } }) { Text("Aggiorna") }
    }
    cancel?.let { b ->
        AlertDialog(
            onDismissRequest = { cancel = null },
            title = { Text("Annullare la prenotazione?") },
            text = { Text("Il credito viene rimborsato secondo le regole dello stabilimento.") },
            confirmButton = {
                TextButton({
                    cancel = null
                    s.perform {
                        s.mutate("reservations/${b.id}", "DELETE")
                        s.refresh()
                    }
                }) {
                    Text("Annulla prenotazione")
                }
            },
            dismissButton = { TextButton({ cancel = null }) { Text("Mantieni") } },
        )
    }
    createSearch?.let { b ->
        AlertDialog(
            onDismissRequest = { createSearch = null },
            title = { Text("Cerco giocatori") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Input("Quanti giocatori?", count, { count = it }, numeric = true)
                    Input("Messaggio", note, { note = it })
                    Hint("Non inserire dati sensibili. Il messaggio è visibile nello stabilimento.")
                }
            },
            confirmButton = {
                TextButton(
                    {
                        createSearch = null
                        s.perform {
                            s.mutate(
                                "player-searches",
                                body =
                                    payload(
                                        "reservationId" to b.id,
                                        "spotsNeeded" to count.toInt(),
                                        "note" to note,
                                    ),
                            )
                            s.message = "Ricerca pubblicata."
                        }
                    },
                    enabled = count.toIntOrNull() in 1..12 && note.length <= 200,
                ) {
                    Text("Pubblica")
                }
            },
            dismissButton = { TextButton({ createSearch = null }) { Text("Indietro") } },
        )
    }
}

@Composable
fun CreditsScreen(s: BeachStore, ads: NativeAds) {
    var adBusy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { s.perform { s.loadCredits() } }
    Page {
        Panel("Il tuo saldo") {
            Text(
                "${s.member?.credits?:0}",
                fontSize = 40.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary,
            )
            Text("1 credito = 1 prenotazione")
        }
        Panel("Ottieni un credito") {
            if (s.member?.demo == true)
                Hint("La demo include crediti di prova. Pubblicità e pagamenti sono disattivati.")
            else if (s.ads.earned) Text("✓ Hai ottenuto il credito di oggi")
            else {
                Action(
                    if (adBusy) "Attendi il video…" else "Guarda un video · 1 credito",
                    !adBusy && s.ads.available && !s.busy,
                ) {
                    adBusy = true
                    scope.launch {
                        val user = s.member?.username
                        val venue = s.selected?.id
                        var token: String? = null
                        try {
                            token =
                                if (BuildConfig.DEBUG) "0".repeat(64)
                                else s.request<RewardToken>("ads/start", "POST", payload()).token
                            val earned =
                                ads.reward(token) {
                                    s.member?.username == user && s.selected?.id == venue
                                }
                            if (BuildConfig.DEBUG)
                                s.message =
                                    if (earned)
                                        "Video di prova completato: nessun credito reale assegnato."
                                    else "Video chiuso."
                            else if (earned) {
                                var credited = false
                                for (i in 0 until 30) {
                                    if (s.member?.username != user || s.selected?.id != venue) break
                                    s.loadCredits()
                                    if (s.ads.earned) {
                                        credited = true
                                        break
                                    }
                                    delay(if (i < 8) 1000 else 2500)
                                }
                                if (s.member?.username == user && s.selected?.id == venue)
                                    s.message =
                                        if (credited) "Il tuo credito è disponibile!"
                                        else
                                            "Video completato. Verifica in corso: aggiorna il saldo tra poco."
                            } else {
                                if (!BuildConfig.DEBUG)
                                    s.mutate("ads/cancel", body = payload("token" to token))
                                s.message = "Completa il video per ottenere il credito."
                            }
                        } catch (e: Exception) {
                            if (
                                token != null &&
                                    !BuildConfig.DEBUG &&
                                    s.member?.username == user &&
                                    s.selected?.id == venue
                            )
                                runCatching {
                                    s.mutate("ads/cancel", body = payload("token" to token))
                                }
                            s.message = e.message
                        } finally {
                            adBusy = false
                        }
                    }
                }
                Hint(
                    "Un video completato e verificato dà un credito. Massimo uno al giorno, secondo disponibilità."
                )
            }
        }
        Panel("Pacchetti crediti") {
            Hint("Gli acquisti non sono ancora disponibili, come nella versione iPhone.")
        }
        Panel("Movimenti") {
            if (s.movements.isEmpty()) Hint("Nessun movimento")
            s.movements.forEach { m ->
                Row {
                    Column(Modifier.weight(1f)) {
                        Text(m.reason.replace('_', ' '))
                        m.at?.let { Hint(it.take(10)) }
                    }
                    Text(if (m.delta > 0) "+${m.delta}" else "${m.delta}")
                }
            }
        }
        TextButton({ s.perform { s.loadCredits() } }) { Text("Aggiorna saldo") }
    }
}

@Composable
fun ShareInvitation(url: String) {
    val context = LocalContext.current
    TextButton({
        context.startActivity(
            Intent.createChooser(
                Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, url),
                "Condividi invito",
            )
        )
    }) {
        Text("Condividi invito")
    }
}

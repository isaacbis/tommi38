import SwiftUI

struct ManagementView: View {
    @EnvironmentObject var store: BeachStore
    var body: some View {
        List {
            Section("Il tuo stabilimento") {
                NavigationLink { StatisticsView() } label: { Label("Statistiche", systemImage: "chart.bar") }
                NavigationLink { AgendaView() } label: { Label("Prenotazioni per giorno", systemImage: "calendar") }
                NavigationLink { UsersView() } label: { Label("Utenti e approvazioni", systemImage: "person.2") }
                NavigationLink { RecoveryRequestsView() } label: { Label("Richieste recupero password", systemImage: "key") }
                NavigationLink { VenueSettingsView() } label: { Label("Campi, orari e foto", systemImage: "slider.horizontal.3") }
                NavigationLink { ClosuresView() } label: { Label("Chiusure e periodi bloccati", systemImage: "lock") }
                NavigationLink { ReportsView() } label: { Label("Segnalazioni giocatori", systemImage: "flag") }
            }
            if store.member?.platformAdmin == true { Section("Amministrazione globale") { NavigationLink { PlatformView() } label: { Label("Stabilimenti e gestori", systemImage: "building.2") }; Text("Puoi creare gli stabilimenti, assegnare i gestori e rettificare i crediti. Ogni gestore vede solo il proprio stabilimento.").font(.caption).foregroundStyle(.secondary) } }
        }
    }
}
struct AgendaView: View {
    @EnvironmentObject var store: BeachStore
    @State private var day = Date()
    @State private var items: [Booking] = []
    @State private var cancel: Booking?
    var body: some View {
        List {
            DatePicker("Giorno", selection: $day, displayedComponents: .date)
            Section("\(items.count) prenotazioni") {
                if items.isEmpty { Text("Nessuna prenotazione in questo giorno").foregroundStyle(.secondary) }
                ForEach(items) { item in VStack(alignment: .leading, spacing: 8) { BookingRow(booking: item); Text(item.status ?? "attiva").font(.caption).foregroundStyle(.secondary); if item.status != "cancelled" { Button("Annulla prenotazione", role: .destructive) { cancel = item }.font(.caption) } } }
            }
        }.navigationTitle("Agenda").task(id: Clock.day(day)) { await load() }.refreshable { await load() }
            .confirmationDialog("Annullare questa prenotazione?", isPresented: Binding(get: { cancel != nil }, set: { if !$0 { cancel = nil } }), titleVisibility: .visible) { Button("Annulla prenotazione", role: .destructive) { let id = cancel?.id ?? ""; cancel = nil; Task { await store.perform { try await store.mutate("admin/reservations/" + id, method: "DELETE") }; await load() } } }
    }
    func load() async { let expectedDay = Clock.day(day); do { let response: Items<Booking> = try await store.request("admin/reservations?date=" + expectedDay); guard !Task.isCancelled, expectedDay == Clock.day(day) else { return }; items = response.items.sorted { $0.time < $1.time } } catch is CancellationError {} catch { if !Task.isCancelled { store.message = error.localizedDescription } } }
}
struct UsersView: View {
    @EnvironmentObject var store: BeachStore
    @State private var query = ""
    @State private var create = false
    var body: some View {
        List {
            ForEach(store.users.filter { query.isEmpty || $0.username.localizedCaseInsensitiveContains(query) }) { user in
                NavigationLink { UserDetailView(user: user) } label: { HStack { VStack(alignment: .leading) { Text(user.username).bold(); Text(user.pendingApproval == true ? "Da approvare" : (user.disabled == true ? "Disabilitato" : user.role == "admin" ? "Gestore" : "Utente")).font(.caption).foregroundStyle(.secondary) }; Spacer(); Text("\(user.credits) crediti").font(.caption) } }
            }
        }.navigationTitle("Utenti").searchable(text: $query, prompt: "Cerca utente").toolbar { Button { create = true } label: { Image(systemName: "plus") } }
            .task { await store.perform { try await store.loadUsers() } }.refreshable { await store.perform { try await store.loadUsers() } }.sheet(isPresented: $create) { NewUserView() }
    }
}
struct NewUserView: View {
    @EnvironmentObject var store: BeachStore
    @Environment(\.dismiss) var dismiss
    @State private var username = ""
    @State private var password = ""
    var body: some View {
        NavigationStack { Form { TextField("Username", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled(); SecureField("Password (almeno 12 caratteri)", text: $password).textContentType(.newPassword); Text("L’utente parte con zero crediti. Conserva le credenziali e comunicale all’utente in modo sicuro.").font(.footnote); Button("Crea utente") { Task { await store.perform { try await store.mutate("admin/users", body: ["username": username, "password": password, "credits": 0, "role": "user"]); password = ""; try await store.loadUsers(); dismiss() } } }.disabled(store.busy || username.count < 3 || password.count < 12) }.navigationTitle("Nuovo utente").toolbar { Button("Chiudi") { dismiss() } } }
    }
}
struct UserDetailView: View {
    @EnvironmentObject var store: BeachStore
    @Environment(\.dismiss) var dismiss
    let user: ManagedUser
    @State private var delta = 1
    @State private var resetPassword = false
    @State private var newUsername = ""
    @State private var chosenRole = "user"
    var body: some View {
        Form {
            Section { Text(user.username).font(.headline); Text("\(user.credits) crediti"); Text(user.pendingApproval == true ? "Iscrizione da approvare" : (user.disabled == true ? "Disabilitato" : "Attivo")) }
            Section { Button("Reimposta password") { resetPassword = true }; Button(user.disabled == true || user.pendingApproval == true ? "Approva / abilita utente" : "Disabilita utente", role: user.disabled == true ? nil : .destructive) { Task { await store.perform { try await store.mutate("admin/users/status", method: "PUT", body: ["username": user.username, "disabled": user.pendingApproval == true ? false : !(user.disabled ?? false)]); try await store.loadUsers(); dismiss() } } }.disabled(store.busy || user.username == store.member?.username) }
            if store.member?.platformAdmin == true {
                Section("Ruolo nello stabilimento") {
                    Picker("Ruolo", selection: $chosenRole) { Text("Utente").tag("user"); Text("Gestore").tag("admin") }
                    Text("Il gestore può amministrare solo questo stabilimento. La modifica richiede un nuovo accesso dell’utente.").font(.caption).foregroundStyle(.secondary)
                    Button("Aggiorna ruolo") { Task { await store.perform { try await store.mutate("admin/users/role", method: "PUT", body: ["username": user.username, "role": chosenRole]); try await store.loadUsers(); dismiss() } } }.disabled(store.busy || chosenRole == user.role || user.username == store.member?.username)
                }
                Section("Rettifica crediti · Solo amministratore globale") { Stepper("Variazione: \(delta > 0 ? "+" : "")\(delta)", value: $delta, in: -100...100); Button("Applica rettifica") { Task { await store.perform { try await store.mutate("admin/users/credits", method: "PUT", body: ["username": user.username, "delta": delta]); try await store.loadUsers(); dismiss() } } }.disabled(store.busy || delta == 0) }
            } else { Text("In CampoPronto ADS i crediti si ottengono con video o pacchetti disponibili. Il gestore non può assegnarli.").font(.footnote).foregroundStyle(.secondary) }
        Section("Nome utente") {
                TextField("Nuovo username", text: $newUsername).textInputAutocapitalization(.never).autocorrectionDisabled()
                Text("Le prenotazioni e i crediti vengono mantenuti. Comunica il nuovo username all’utente.").font(.caption).foregroundStyle(.secondary)
                Button("Rinomina utente") { Task { await store.perform { try await store.mutate("admin/users/rename", body: ["oldUsername": user.username, "newUsername": newUsername]); try await store.loadUsers(); dismiss() } } }.disabled(store.busy || newUsername == user.username || newUsername.range(of: "^[a-zA-Z0-9._-]{3,40}$", options: .regularExpression) == nil || user.username == store.member?.username)
            }
        }.navigationTitle("Gestisci utente").onAppear { newUsername = user.username; chosenRole = user.role }.sheet(isPresented: $resetPassword) { PasswordView(target: user.username) }
    }
}
struct VenueSettingsView: View {
    @EnvironmentObject var store: BeachStore
    @State private var config = VenueConfig()
    @State private var note = ""
    @State private var photos: [Photo] = []
    var body: some View {
        Form {
            Section("Orari") {
                TextField("Apertura HH:mm", text: $config.dayStart).keyboardType(.numbersAndPunctuation)
                TextField("Chiusura HH:mm", text: $config.dayEnd).keyboardType(.numbersAndPunctuation)
                Stepper("Durata: \(config.slotMinutes) minuti", value: $config.slotMinutes, in: 5...240, step: 5)
                Stepper("Prenotazioni per giorno: \(config.maxBookingsPerUserPerDay)", value: $config.maxBookingsPerUserPerDay, in: 1...50)
                Stepper("Prenotazioni attive: \(config.maxActiveBookingsPerUser)", value: $config.maxActiveBookingsPerUser, in: 1...100)
                Toggle("Consenti richieste di iscrizione", isOn: Binding(get: { config.registrationEnabled ?? false }, set: { config.registrationEnabled = $0 }))
                Button("Salva orari") { Task { await store.perform { try await store.mutate("admin/config", method: "PUT", body: ["slotMinutes": config.slotMinutes, "dayStart": config.dayStart, "dayEnd": config.dayEnd, "maxBookingsPerUserPerDay": config.maxBookingsPerUserPerDay, "maxActiveBookingsPerUser": config.maxActiveBookingsPerUser, "registrationEnabled": config.registrationEnabled ?? false]); try await store.refresh(); store.message = "Orari salvati." } } }.disabled(store.busy || !Clock.validTime(config.dayStart) || !Clock.validTime(config.dayEnd) || Clock.minutes(config.dayEnd) - Clock.minutes(config.dayStart) < config.slotMinutes)
            }
            Section("Campi") {
                ForEach(config.fields.indices, id: \.self) { i in HStack { TextField("Nome campo", text: $config.fields[i].name); Button { config.fields.remove(at: i) } label: { Image(systemName: "minus.circle").foregroundStyle(.red) }.buttonStyle(.plain) } }
                Button("Aggiungi campo") { config.fields.append(Field(id: "campo-" + UUID().uuidString.lowercased(), name: "Campo \(config.fields.count + 1)")) }
                Button("Salva campi") { Task { await store.perform { try await store.mutate("admin/fields", method: "PUT", body: ["fields": config.fields.map { ["id": $0.id, "name": $0.name] }]); try await store.refresh(); store.message = "Campi salvati." } } }.disabled(store.busy || config.fields.isEmpty)
                Text("I campi con prenotazioni non possono essere rimossi.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Comunicazione agli utenti") { TextField("Messaggio", text: $note, axis: .vertical); Button("Salva messaggio") { Task { await store.perform { try await store.mutate("admin/notes", method: "PUT", body: ["text": note]); try await store.refresh(); store.message = "Messaggio salvato." } } }.disabled(store.busy) }
            Section("Foto dello stabilimento") {
                GalleryView(photos: photos)
                ForEach(photos.indices, id: \.self) { i in VStack { TextField("URL immagine https://", text: $photos[i].url).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled(); TextField("Didascalia", text: Binding(get: { photos[i].caption ?? "" }, set: { photos[i].caption = $0 })); TextField("Link facoltativo https://", text: Binding(get: { photos[i].link ?? "" }, set: { photos[i].link = $0 })).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled(); Button("Rimuovi foto", role: .destructive) { photos.remove(at: i) }.font(.caption) } }
                if photos.count < 10 { Button("Aggiungi foto") { photos.append(Photo(url: "", caption: "", link: "")) } }
                Text("Pubblica solo immagini per cui hai i diritti e il consenso delle persone riconoscibili.").font(.caption).foregroundStyle(.secondary)
                Button("Salva foto") { Task { await store.perform { guard photos.allSatisfy({ URL(string: $0.url)?.scheme == "https" }) else { throw APIError(code: "URL_FOTO_NON_VALIDO") }; try await store.mutate("admin/gallery", method: "PUT", body: ["images": photos.map { ["url": $0.url, "caption": $0.caption ?? "", "link": $0.link ?? ""] }]); try await store.refresh(); store.message = "Foto salvate." } } }.disabled(store.busy)
            }
        }.navigationTitle("Impostazioni").onAppear { config = store.config; note = store.config.notesText ?? ""; photos = store.config.gallery ?? [] }
    }
}
struct ClosuresView: View {
    @EnvironmentObject var store: BeachStore
    @State private var field = ""
    @State private var startDate = Date()
    @State private var endDate = Date()
    @State private var start = "08:00"
    @State private var end = "23:00"
    @State private var reason = "Chiusura campo"
    @State private var closures: [Closure] = []
    var body: some View {
        Form {
            Section("Blocca un periodo") {
                Picker("Campo", selection: $field) { ForEach(store.config.fields) { Text($0.name).tag($0.id) } }
                DatePicker("Da", selection: $startDate, displayedComponents: .date)
                DatePicker("Fino a", selection: $endDate, in: startDate..., displayedComponents: .date)
                TextField("Ora inizio HH:mm", text: $start).keyboardType(.numbersAndPunctuation)
                TextField("Ora fine HH:mm", text: $end).keyboardType(.numbersAndPunctuation)
                TextField("Motivo", text: $reason)
                Button("Blocca campo") { Task { await store.perform { try await store.mutate("admin/closures", body: ["fieldId": field, "startDate": Clock.day(startDate), "endDate": Clock.day(endDate), "start": start, "end": end, "reason": reason]); try await load(); store.message = "Periodo bloccato." } } }.disabled(store.busy || field.isEmpty || reason.isEmpty || !Clock.validTime(start) || !Clock.validTime(end) || Clock.minutes(end) <= Clock.minutes(start) || Clock.day(endDate) < Clock.day(startDate))
                Text("Il periodo include la data finale. Le prenotazioni esistenti non vengono cancellate automaticamente.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Chiusure programmate") { ForEach(closures) { c in VStack(alignment: .leading) { Text(store.config.fields.first { $0.id == c.fieldId }?.name ?? c.fieldId).bold(); Text("\(c.startDate ?? c.date ?? "") – \(c.endDate ?? c.date ?? "") · \(c.start)–\(c.end)").font(.caption); Text(c.reason ?? "").font(.caption); Button("Rimuovi chiusura", role: .destructive) { Task { await store.perform { try await store.mutate("admin/closures/" + c.id, method: "DELETE"); try await load() } } }.font(.caption) } } }
        }.navigationTitle("Chiusure").task { field = store.config.fields.first?.id ?? ""; start = store.config.dayStart; end = store.config.dayEnd; await store.perform { try await load() } }
    }
    func load() async throws { let result: Operations = try await store.request("admin/operations"); closures = result.closures ?? [] }
}
struct Operations: Decodable { var closures: [Closure]?; var users: Int?; var credits: Int?; var upcoming: Int?; var byField: [String:Int]? }
struct PlatformView: View {
    @EnvironmentObject var store: BeachStore
    @State private var create = false
    var body: some View {
        List { ForEach(store.platformVenues) { venue in NavigationLink { PlatformVenueView(venue: venue) } label: { HStack { VStack(alignment: .leading) { Text(venue.name).bold(); Text(venue.visibility == "public" ? "Visibile agli utenti" : "Privato").font(.caption).foregroundStyle(.secondary) }; Spacer(); if store.selected?.id == venue.id { Image(systemName: "checkmark.circle.fill") } } } } }.navigationTitle("Tutti gli stabilimenti").toolbar { Button { create = true } label: { Image(systemName: "plus") } }.task { await store.perform { try await store.loadPlatform() } }.sheet(isPresented: $create) { NewVenueView() }
    }
}
struct NewVenueView: View {
    @EnvironmentObject var store: BeachStore
    @Environment(\.dismiss) var dismiss
    @State private var name = ""
    @State private var id = ""
    @State private var username = ""
    @State private var password = ""
    var body: some View {
        NavigationStack { Form { TextField("Nome stabilimento", text: $name); TextField("Identificativo (es. lido-sole)", text: $id).textInputAutocapitalization(.never).autocorrectionDisabled(); Section("Gestore") { TextField("Username", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled(); SecureField("Password (almeno 12 caratteri)", text: $password).textContentType(.newPassword) }; Text("Lo stabilimento nasce privato. Il gestore può impostare i propri campi, orari e utenti. Le sue credenziali non danno accesso agli altri stabilimenti.").font(.footnote); Button("Crea stabilimento e gestore") { Task { await store.perform { try await store.mutate("platform/establishments", body: ["id": id, "name": name, "managerUsername": username, "managerPassword": password]); password = ""; try await store.loadPlatform(); dismiss() } } }.disabled(name.isEmpty || id.isEmpty || username.isEmpty || password.count < 12 || store.busy) }.navigationTitle("Nuovo stabilimento").toolbar { Button("Chiudi") { dismiss() } } }
    }
}
struct CommunityReport: Decodable, Identifiable { let id: String; var reason: String?; var reportedUser: String?; var date: String?; var time: String? }
struct ReportsView: View {
    @EnvironmentObject var store: BeachStore
    @State private var items: [CommunityReport] = []
    var body: some View { List { if items.isEmpty { Text("Nessuna segnalazione aperta") }; ForEach(items) { r in VStack(alignment: .leading) { Text(r.reportedUser ?? "Utente").bold(); Text(r.reason ?? "Segnalazione"); HStack { Button("Nascondi ricerca", role: .destructive) { resolve(r, action: "close-search") }; Button("Risolvi") { resolve(r, action: "resolve") } } } } }.navigationTitle("Segnalazioni").task { await store.perform { try await load() } } }
    func load() async throws { let r: Items<CommunityReport> = try await store.request("admin/community-reports"); items = r.items }
    func resolve(_ r: CommunityReport, action: String) { Task { await store.perform { try await store.mutate("admin/community-reports/" + r.id, method: "PATCH", body: ["action": action]); try await load() } } }
}

struct StatisticsView: View {
    @EnvironmentObject var store: BeachStore
    @State private var stats: Operations?
    var body: some View { List { LabeledContent("Utenti", value: String(stats?.users ?? 0)); LabeledContent("Prenotazioni future", value: String(stats?.upcoming ?? 0)); LabeledContent("Crediti complessivi", value: String(stats?.credits ?? 0)); Section("Prenotazioni per campo") { ForEach(store.config.fields) { field in LabeledContent(field.name, value: String(stats?.byField?[field.id] ?? 0)) } } }.navigationTitle("Statistiche").task { await store.perform { stats = try await store.request("admin/operations") } } }
}
struct PlatformVenueView: View {
    @EnvironmentObject var store: BeachStore
    @Environment(\.dismiss) var dismiss
    let venue: Venue
    @State private var name = ""
    @State private var city = ""
    @State private var visible = false
    @State private var enabled = true
    @State private var latitude = ""
    @State private var longitude = ""
    var body: some View {
        Form {
            Section { TextField("Nome stabilimento", text: $name); TextField("Città", text: $city); TextField("Latitudine (facoltativa)", text: $latitude).keyboardType(.numbersAndPunctuation); TextField("Longitudine (facoltativa)", text: $longitude).keyboardType(.numbersAndPunctuation); Toggle("Visibile nella ricerca", isOn: $visible); if venue.id != "tommi38" { Toggle("Stabilimento attivo", isOn: $enabled) }; Text("Uno stabilimento privato non compare nella ricerca pubblica. Gli utenti già abilitati mantengono il proprio accesso.").font(.footnote).foregroundStyle(.secondary) }
            Button("Salva") { Task { await store.perform { var body: [String:Any] = ["name": name, "city": city, "visibility": visible ? "public" : "private", "enabled": enabled]
                if latitude.isEmpty && longitude.isEmpty { body["latitude"] = NSNull(); body["longitude"] = NSNull() }
                else { guard let lat = Double(latitude.replacingOccurrences(of: ",", with: ".")), let lon = Double(longitude.replacingOccurrences(of: ",", with: ".")), (-90...90).contains(lat), (-180...180).contains(lon) else { throw APIError(code: "COORDINATE_NON_VALIDE") }; body["latitude"] = lat; body["longitude"] = lon }
                try await store.mutate("platform/establishments/" + venue.id, method: "PATCH", body: body); try await store.loadPlatform(); dismiss() } } }.disabled(store.busy || name.isEmpty)
            ShareLink(item: URL(string: "campopronto://venue?id=" + venue.id)!) { Label("Condividi invito all’app", systemImage: "square.and.arrow.up") }
            Button("Gestisci questo stabilimento") { Task { await store.switchVenue(venue); if store.selected?.id == venue.id { dismiss() } } }.disabled(store.busy || !enabled)
        }.navigationTitle(venue.name).onAppear { name = venue.name; city = venue.city ?? ""; visible = venue.visibility == "public"; enabled = venue.enabled ?? true; latitude = venue.latitude.map { String($0) } ?? ""; longitude = venue.longitude.map { String($0) } ?? "" }
    }
}

struct RecoveryRequest: Decodable, Identifiable { let username: String; var id: String { username } }
struct RecoveryRequestsView: View {
    @EnvironmentObject var store: BeachStore
    @State private var items: [RecoveryRequest] = []
    var body: some View {
        List {
            if items.isEmpty { Text("Nessuna richiesta in attesa").foregroundStyle(.secondary) }
            ForEach(items) { request in NavigationLink { PasswordView(target: request.username) } label: { Label(request.username, systemImage: "key") } }
            Text("Verifica l’identità dell’utente prima di reimpostare la password e comunica le credenziali in modo sicuro.").font(.caption).foregroundStyle(.secondary)
        }.navigationTitle("Recupero password").task { await load() }.refreshable { await load() }
    }
    func load() async { await store.perform { let response: Items<RecoveryRequest> = try await store.request("auth/admin/recovery-requests"); items = response.items } }
}

# CampoPronto ADS nativo

Interfaccia SwiftUI collegata al servizio esistente `https://tommi38.onrender.com/api`. Non crea un database Firebase separato e non usa WKWebView. Gli account, i controlli sui ruoli e gli accrediti verificati rimangono sul backend esistente.

Aprire `ios/Tommi38.xcodeproj`. Versione 2.0, build 41. Bundle `isaacmorganti.Tommi38IOS`, team già usato dalla versione pubblicata. Xcode 27, iOS 17 o successivo. Google Mobile Ads 13.10.0 e UMP 3.1.0 fissati nel progetto.

Debug mostra solo annunci di test e non assegna crediti reali. Release usa le unità AdMob di produzione; solo la conferma firmata del server può assegnare un credito. La demo pubblica non mostra annunci e non effettua pagamenti. I pacchetti a pagamento restano disattivati.

Sessione nel portachiavi locale, nessuna password salvata. Posizione approssimativa usata solo sul dispositivo per ordinare gli stabilimenti. Promemoria locali facoltativi sincronizzati alle prenotazioni dopo l’aggiornamento dei dati. Nessuna notifica push remota.

Gli inviti privati usano `campopronto://venue?id=identificativo`. La conoscenza dell’invito non autorizza l’accesso ai dati: occorre autenticarsi e il backend applica il controllo dello stabilimento.

Verifiche:

```sh
swiftc -parse-as-library ios/Tommi38/Models.swift tests/NativeModelsTests.swift -o /tmp/native-model-tests
/tmp/native-model-tests
xcodebuild -project ios/Tommi38.xcodeproj -scheme Tommi38 -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build
```

Archivio di distribuzione:

```sh
xcodebuild -project ios/Tommi38.xcodeproj -scheme Tommi38 -configuration Release -destination 'generic/platform=iOS' -archivePath /tmp/CampoProntoADS.xcarchive -allowProvisioningUpdates archive
```

La base originale ricevuta sul Desktop è stata conservata in `/tmp/CampoPronto-original-native-20261003.zip`. Il progetto Firebase indipendente fornito inizialmente non viene distribuito.

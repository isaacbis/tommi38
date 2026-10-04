# CampoPronto ADS 2.1 (55)

Registrazione stabilimento: numero clienti digitabile da 1 a 1.000, tastiera numerica e pulsante Fine. Il pulsante Crea resta disabilitato per valori vuoti, non interi o fuori intervallo. Numerazione progressiva e PDF restano invariati; tutti i clienti partono con zero crediti.

API Firebase: schema esteso a 1.000. Conservata creazione atomica e password individuali cifrate con bcrypt. Per la registrazione massiva, timeout funzione 300 secondi e chiamata nativa diretta allo stesso servizio Firebase, per evitare il timeout del proxy Hosting; gli altri endpoint conservano il percorso abituale.

Verifica: cinque test di registrazione superati, inclusi 997/998/1.000 clienti e rifiuto di 1.001. Build Debug iPhone e archivio Release firmato riusciti. Nel simulatore digitato 1.000 e verificato il riepilogo user001–user1000, senza creare account reali. Progetto Desktop sincronizzato. Firebase Functions e Hosting distribuiti con successo.

TestFlight: due tentativi export/upload non riusciti per timeout del servizio Apple lookupGenericSettingsForSubmission (errore -1001). Build 55 pronta nell'archivio /tmp/CampoProntoADS-native-2.1-build55.xcarchive, ma non caricata su TestFlight. Non è stata modificata la submission App Store esistente.

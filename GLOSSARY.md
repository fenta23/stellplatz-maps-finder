# Camp Finder

Eine Karten-App für Wanderer, Radfahrer und Camper, die Orte wie Wasser, Einkehr, Unterkunft und Stellplätze zeigt, auf Wunsch entlang einer Route.

## Language

### Orte

**Ort**:
Ein Punkt auf der Karte, den die App wegen seines Nutzens zeigt, zum Beispiel eine Wasserstelle, ein Stellplatz, eine Hütte oder eine Bäckerei.
_Avoid_: POI, Spot, Platz, Location

**Eigener Ort**:
Ein Ort, den jemand selbst auf die Karte gesetzt und beschrieben hat. Er gehört zum eingebauten Filter „Eigene Orte“.
_Avoid_: Eigener POI, Custom POI, Markierung, Pin

**Favorit**:
Ein Ort, den jemand mit dem Herz gemerkt hat.
_Avoid_: Lesezeichen, Merkliste, Stern

**Notiz**:
Ein eigener Text, den jemand zu einem Ort festhält. Nur die Person selbst sieht ihn.
_Avoid_: Kommentar, Anmerkung, Note

**Community-Hinweis**:
Ein öffentlicher Hinweis aus OpenStreetMap zur Umgebung eines Ortes, den andere hinterlassen haben. Er ist keine Notiz.
_Avoid_: Notiz, OSM-Note, Kommentar

**Suchtreffer**:
Etwas, das die Ortssuche zu einem eingegebenen Namen findet, etwa ein Dorf, ein Berg, ein See oder eine Adresse. Ein Suchtreffer kann Start oder Ziel einer Route werden, ist aber kein Ort.
_Avoid_: Ort, Ortschaft, Place, Adresse

### Filter und Profile

**Filter**:
Eine Art von Orten, zum Beispiel Bäckerei, Wasserstelle oder Camper-Stellplatz, die sich auf der Karte ein- und ausblenden lässt. Jeder Ort gehört zu genau einem Filter.
_Avoid_: Kategorie, Typ, POI-Typ, Ebene

**Eingebauter Filter**:
Ein Filter, den die App mitbringt.
_Avoid_: Standardfilter, Systemfilter

**Eigener Filter**:
Ein Filter, den jemand selbst angelegt hat, entweder von Hand oder über die KI-Suche.
_Avoid_: Custom Filter, persönlicher Filter, benutzerdefinierter Filter

**Profil**:
Eine Zielgruppe (Wandern, Radfahren, Camping), die festlegt, welche eingebauten Filter gezeigt werden. Man kann mehrere Profile zugleich wählen, eigene Filter bleiben davon unberührt.
_Avoid_: Modus, Persona, Nutzertyp

### Routen

**Route**:
Eine Linie auf der Karte, entlang der die App Orte sucht, egal ob importiert oder im Routenplaner berechnet. Woher sie stammt, ist nur eine Eigenschaft der Route und macht keinen eigenen Begriff aus.
_Avoid_: Track, Strecke, Tour (außer als Komoot-Begriff für die Quelle eines Imports)

**Geplante Route**:
Eine Route, die der Routenplaner aus Start, Ziel, Zwischenpunkten und Verkehrsmittel berechnet hat. Sie lässt sich auf der Karte nachträglich ändern.
_Avoid_: Plan, berechnete Route

**Importierte Route**:
Eine Route aus einer GPX-Datei oder einem Komoot-Link. Sie bleibt so, wie sie geladen wurde.
_Avoid_: Track, Tour

**Verkehrsmittel**:
Wie eine geplante Route berechnet wird: zu Fuß, mit dem Rad oder mit dem Auto. Solange noch keins gewählt wurde, gibt das Profil den Startwert vor, danach gilt die letzte Wahl.
_Avoid_: Modus, Fortbewegungsart

**Korridor**:
Der Bereich links und rechts einer Route, in dem die App Orte sucht.
_Avoid_: Puffer, Suchradius, Umkreis

**Abstand**:
Wie weit der Korridor zu jeder Seite der Route reicht, in Metern.
_Avoid_: Breite, Radius, Korridorbreite

**Start**:
Der Punkt, an dem eine geplante Route beginnt.
_Avoid_: Wegpunkt, Startpunkt, Endpunkt

**Ziel**:
Der Punkt, an dem eine geplante Route endet.
_Avoid_: Wegpunkt, Endpunkt, Zielpunkt

**Zwischenpunkt**:
Ein Punkt zwischen Start und Ziel, durch den eine geplante Route führen muss.
_Avoid_: Wegpunkt, Via, Via-Punkt

### Karte

**Kartenebene**:
Das Hintergrundbild der Karte, also Karte, Satellit, Fahrradkarte oder Topografische Karte. Es kann immer nur eine Kartenebene aktiv sein.
_Avoid_: Ebene (allein, mehrdeutig), Basiskarte, Kartenstil, Layer

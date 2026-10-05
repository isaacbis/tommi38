package it.campopronto.ads

import org.junit.Assert.*
import org.junit.Test

class ModelsTest {
    @Test
    fun slotsDoNotOverrunClosingTime() {
        assertEquals(
            listOf("09:00", "09:40", "10:20"),
            Clock.slots(VenueConfig(dayStart = "09:00", dayEnd = "11:00", slotMinutes = 40)),
        )
    }

    @Test
    fun invalidHoursDoNotCreateSlots() {
        assertFalse(Clock.validTime("25:00"))
        assertFalse(Clock.validTime("08:75"))
        assertTrue(Clock.slots(VenueConfig(slotMinutes = 0)).isEmpty())
        assertTrue(Clock.slots(VenueConfig(dayStart = "23:00", dayEnd = "08:00")).isEmpty())
    }

    @Test
    fun adjacentBookingsAreNotOverlapping() {
        val b = Booking("b", "volley", "2026-10-06", "10:00", slotMinutes = 60)
        assertTrue(b.overlaps("2026-10-06", "volley", "10:40", 40, 40))
        assertFalse(b.overlaps("2026-10-06", "volley", "11:00", 40, 40))
        assertFalse(b.overlaps("2026-10-07", "volley", "10:00", 40, 40))
        assertFalse(b.copy(status = "cancelled").overlaps("2026-10-06", "volley", "10:00", 40, 40))
    }

    @Test
    fun closureIncludesEndDateAndHandlesOverlap() {
        val c =
            Closure(
                "c",
                "volley",
                startDate = "2026-10-06",
                endDate = "2026-10-09",
                start = "10:00",
                end = "12:00",
            )
        assertTrue(c.contains("2026-10-09", "11:40", 40))
        assertFalse(c.contains("2026-10-10", "11:00", 40))
        assertFalse(c.contains("2026-10-09", "12:00", 40))
        assertTrue(c.contains("2026-10-06", "09:40", 40))
    }

    @Test
    fun romeClockIncludesSeasonalTimeChange() {
        assertEquals("2026-10-24T08:00:00Z", Clock.instant("2026-10-24", "10:00").toString())
        assertEquals("2026-10-26T09:00:00Z", Clock.instant("2026-10-26", "10:00").toString())
    }

    @Test
    fun clientCountSupportsDirectValuesUpTo1000() {
        assertTrue(Clock.countValid("1000"))
        assertTrue(Clock.countValid("998"))
        assertFalse(Clock.countValid("1001"))
        assertFalse(Clock.countValid("0"))
        assertFalse(Clock.countValid("1.5"))
    }

    @Test
    fun coordinatesAreOnlyUsedForLocalOrdering() {
        val v = Venue("a", "A", latitude = 43.9, longitude = 10.2)
        assertTrue(Clock.distance(43.9, 10.2, v) < .01)
        assertEquals(Double.MAX_VALUE, Clock.distance(43.9, 10.2, Venue("b", "B")), 0.0)
    }
}

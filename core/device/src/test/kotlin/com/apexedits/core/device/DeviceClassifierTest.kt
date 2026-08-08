package com.apexedits.core.device

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

private fun capabilities(
    totalMemoryMb: Long = 6_000,
    cpuCores: Int = 8,
    mediaPerformanceClass: Int = 0,
    isLowRamDevice: Boolean = false,
) = DeviceCapabilities(
    totalMemoryMb = totalMemoryMb,
    availableMemoryMb = totalMemoryMb / 2,
    cpuCores = cpuCores,
    mediaPerformanceClass = mediaPerformanceClass,
    availableStorageMb = 8_000,
    isLowRamDevice = isLowRamDevice,
    supportsHevcHardware = true,
)

/**
 * The classifier is a pure function over measured facts precisely so these
 * boundaries can be pinned down without an emulator.
 */
class DeviceClassifierTest {

    @Test
    fun `a 3GB phone is classed low`() {
        // The PRD's floor case: 2-3 GB devices must run, with proxies.
        assertEquals(DeviceClass.LOW, classify(capabilities(totalMemoryMb = 3_000, cpuCores = 8)))
    }

    @Test
    fun `a 6GB phone is classed medium and an 8GB one high`() {
        assertEquals(DeviceClass.MEDIUM, classify(capabilities(totalMemoryMb = 6_000)))
        assertEquals(DeviceClass.HIGH, classify(capabilities(totalMemoryMb = 8_000)))
    }

    @Test
    fun `too few cores forces low regardless of memory`() {
        // Plenty of RAM does not help if there are not enough cores to decode
        // and composite at the same time.
        assertEquals(DeviceClass.LOW, classify(capabilities(totalMemoryMb = 8_000, cpuCores = 4)))
    }

    @Test
    fun `the manufacturer's low-RAM declaration overrides everything`() {
        val generous = capabilities(totalMemoryMb = 8_000, cpuCores = 8, isLowRamDevice = true)
        assertEquals(DeviceClass.LOW, classify(generous))
    }

    @Test
    fun `media performance class outranks a modest RAM figure`() {
        // A certified device has been measured against exactly this workload,
        // which is better evidence than a RAM number.
        val certified = capabilities(totalMemoryMb = 4_000, cpuCores = 8, mediaPerformanceClass = 33)
        assertEquals(DeviceClass.HIGH, classify(certified))
    }

    @Test
    fun `low tier never offers 4K export`() {
        // Offering a 4K export that reliably overheats is worse than not
        // offering it, which is why the ceiling is in the policy not the UI.
        val policy = PerformancePolicy.forClass(DeviceClass.LOW)
        assertEquals(1080, policy.exportMaxDimension)
        assertTrue(policy.proxiesByDefault)
        assertEquals(CaptionModel.TINY, policy.recommendedCaptionModel)
    }

    @Test
    fun `higher tiers are monotonically more generous`() {
        val low = PerformancePolicy.forClass(DeviceClass.LOW)
        val medium = PerformancePolicy.forClass(DeviceClass.MEDIUM)
        val high = PerformancePolicy.forClass(DeviceClass.HIGH)

        assertTrue(low.previewMaxDimension <= medium.previewMaxDimension)
        assertTrue(medium.previewMaxDimension <= high.previewMaxDimension)
        assertTrue(low.exportMaxDimension <= medium.exportMaxDimension)
        assertTrue(medium.exportMaxDimension <= high.exportMaxDimension)
        assertTrue(low.softTrackLimit <= medium.softTrackLimit)
        assertTrue(medium.softTrackLimit <= high.softTrackLimit)
    }

    @Test
    fun `a throttling device drops to safer settings even on a flagship`() {
        val profile = DeviceProfile(
            capabilities = capabilities(totalMemoryMb = 12_000),
            deviceClass = DeviceClass.HIGH,
            thermalState = ThermalState.SEVERE,
        )
        // A hot flagship is, for the next few minutes, not a flagship.
        assertEquals(1080, profile.effectivePolicy.exportMaxDimension)
        assertTrue(profile.effectivePolicy.proxiesByDefault)
        // The underlying classification is unchanged; only the policy adapts.
        assertEquals(3840, profile.basePolicy.exportMaxDimension)
    }

    @Test
    fun `safer settings never raise a limit`() {
        for (deviceClass in DeviceClass.entries) {
            val base = PerformancePolicy.forClass(deviceClass)
            val safer = base.safer()
            assertTrue(safer.previewMaxDimension <= base.previewMaxDimension)
            assertTrue(safer.exportMaxDimension <= base.exportMaxDimension)
            assertTrue(safer.warnBeforeHeavyOperations)
        }
    }

    @Test
    fun `a user override replaces the tier default but still yields to heat`() {
        val override = PerformancePolicy.forClass(DeviceClass.HIGH)
        val profile = DeviceProfile(
            capabilities = capabilities(totalMemoryMb = 3_000),
            deviceClass = DeviceClass.LOW,
            userOverride = override,
        )
        // The user asked for full quality on a weak device; that is their call.
        assertEquals(3840, profile.effectivePolicy.exportMaxDimension)
        // But heat still wins.
        assertEquals(1080, profile.copy(thermalState = ThermalState.SEVERE).effectivePolicy.exportMaxDimension)
    }

    @Test
    fun `every heavy operation explains itself in plain language`() {
        for (operation in HeavyOperation.entries) {
            assertTrue(operation.displayName.isNotBlank())
            assertTrue("${operation.name} lacks a reason", operation.why.length > 40)
        }
    }

    @Test
    fun `the low resource warning carries the PRD's three choices`() {
        val warning = LowResourceWarning(HeavyOperation.EXPORT_HIGH_RESOLUTION, DeviceClass.LOW)
        assertEquals("Limited Device Resources Detected", warning.title)
        assertEquals("Use Safer Settings", warning.saferButton)
        assertEquals("Continue Anyway", warning.continueButton)
        assertEquals("Don't show again for this device", warning.suppressButton)
        assertTrue(warning.body.contains("overheating"))
    }
}

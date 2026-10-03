package com.codingagent.core

import com.codingagent.agent.AgentAction
import com.codingagent.agent.AgentActionCategory
import com.codingagent.agent.AgentConstitution
import com.codingagent.agent.ConstitutionRule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * THE OWNER'S LAW — carved in steel. These tests pin the 12 rules exactly as the
 * owner wrote them. If any of them fail, the law was touched. Restore it.
 * (AgentConstitution.kt is never modified — not even comments.)
 */
class TwelveRulesLawTest {
    private fun compliant(category: AgentActionCategory) = AgentAction(
        description = "law check",
        category = category,
        ownerVerified = true,
        approvalCount = 2,
        sandboxPassed = true,
        clearPermission = true
    )

    private fun rulesOf(action: AgentAction, approvalAt: Long? = null) =
        AgentConstitution.check(action, approvalAt = approvalAt).map { it.rule }

    @Test
    fun twelveRulesExistUnchanged() {
        assertEquals(
            listOf(
                "OWNER_LOCK", "DEFAULT_NO", "CLEAR_PERMISSION", "DOUBLE_CONFIRMATION",
                "SANDBOX_FIRST", "TRANSPARENCY_LOG", "IMMEDIATE_STOP", "PERMISSION_EXPIRATION",
                "NO_SILENT_BACKGROUND_POWER", "DATA_LOYALTY", "ANTI_IMPERSONATION", "SAFETY_BOUNDARY"
            ),
            ConstitutionRule.values().map { it.name }
        )
        assertEquals(30 * 60 * 1000L, AgentConstitution.APPROVAL_EXPIRATION_MS)
    }

    @Test
    fun ownerLockBlocksAnythingUnverified() {
        val violations = AgentConstitution.check(compliant(AgentActionCategory.CODE_CHANGE).copy(ownerVerified = false))
        assertTrue(violations.any { it.rule == ConstitutionRule.OWNER_LOCK && it.blocking })
        // Reads are never locked out.
        assertTrue(AgentConstitution.check(AgentAction("r", AgentActionCategory.READ_ONLY)).isEmpty())
    }

    @Test
    fun defaultNoBlocksZeroApprovals() {
        val violations = AgentConstitution.check(compliant(AgentActionCategory.CODE_CHANGE).copy(approvalCount = 0))
        assertTrue(violations.any { it.rule == ConstitutionRule.DEFAULT_NO && it.blocking })
    }

    @Test
    fun clearPermissionBlocksVagueRequests() {
        val violations = AgentConstitution.check(compliant(AgentActionCategory.CODE_CHANGE).copy(clearPermission = false))
        assertTrue(violations.any { it.rule == ConstitutionRule.CLEAR_PERMISSION && it.blocking })
    }

    @Test
    fun doubleConfirmationRequiresTwoApprovals() {
        val one = AgentConstitution.check(compliant(AgentActionCategory.CODE_CHANGE).copy(approvalCount = 1))
        val violation = one.single { it.rule == ConstitutionRule.DOUBLE_CONFIRMATION }
        assertTrue(violation.blocking)
        assertEquals("This action requires two approvals", violation.message)
        assertTrue(rulesOf(compliant(AgentActionCategory.CODE_CHANGE)).isEmpty())
    }

    @Test
    fun sandboxFirstBlocksUntestedCodeAndModelChanges() {
        assertTrue(
            rulesOf(compliant(AgentActionCategory.CODE_CHANGE).copy(sandboxPassed = false))
                .contains(ConstitutionRule.SANDBOX_FIRST)
        )
        assertTrue(
            rulesOf(compliant(AgentActionCategory.MODEL_CHANGE).copy(sandboxPassed = false))
                .contains(ConstitutionRule.SANDBOX_FIRST)
        )
        assertTrue(rulesOf(compliant(AgentActionCategory.CODE_CHANGE)).isEmpty())
    }

    @Test
    fun immediateStopHaltsEverythingExceptReads() {
        val halted = AgentConstitution.check(compliant(AgentActionCategory.CODE_CHANGE).copy(lockdown = true))
        assertEquals(listOf(ConstitutionRule.IMMEDIATE_STOP), halted.map { it.rule })
        assertTrue(halted.single().blocking)
        assertTrue(AgentConstitution.check(AgentAction("r", AgentActionCategory.READ_ONLY, lockdown = true)).isEmpty())
    }

    @Test
    fun silentBackgroundPowerIsBlocked() {
        val violations = AgentConstitution.check(compliant(AgentActionCategory.CODE_CHANGE).copy(silent = true))
        assertTrue(violations.any { it.rule == ConstitutionRule.NO_SILENT_BACKGROUND_POWER && it.blocking })
    }

    @Test
    fun dataSharingNeedsExplicitPerConnectionApproval() {
        val denied = AgentConstitution.check(compliant(AgentActionCategory.DATA_SHARE))
        assertTrue(denied.any { it.rule == ConstitutionRule.DATA_LOYALTY && it.blocking })
        val allowed = AgentConstitution.check(compliant(AgentActionCategory.DATA_SHARE).copy(explicitShareApproval = true))
        assertTrue(allowed.isEmpty())
    }

    @Test
    fun voiceCannotForceCriticalChanges() {
        val violations = AgentConstitution.check(compliant(AgentActionCategory.CODE_CHANGE).copy(voiceInitiated = true))
        assertTrue(violations.any { it.rule == ConstitutionRule.ANTI_IMPERSONATION && it.blocking })
        assertTrue(AgentConstitution.check(AgentAction("r", AgentActionCategory.READ_ONLY, voiceInitiated = true)).isEmpty())
    }

    @Test
    fun approvalsExpireAfterThirtyMinutes() {
        val now = System.currentTimeMillis()
        val expired = AgentConstitution.check(
            compliant(AgentActionCategory.CODE_CHANGE),
            now = now,
            approvalAt = now - AgentConstitution.APPROVAL_EXPIRATION_MS - 1
        )
        assertTrue(expired.any { it.rule == ConstitutionRule.PERMISSION_EXPIRATION && it.blocking })
        val fresh = AgentConstitution.check(
            compliant(AgentActionCategory.CODE_CHANGE),
            now = now,
            approvalAt = now - AgentConstitution.APPROVAL_EXPIRATION_MS + 60_000
        )
        assertTrue(fresh.isEmpty())
    }

    @Test
    fun fullyCompliantChangeIsAllowed() {
        assertTrue(AgentConstitution.isAllowed(compliant(AgentActionCategory.CODE_CHANGE)))
        assertTrue(AgentConstitution.isAllowed(compliant(AgentActionCategory.MODEL_CHANGE)))
    }
}

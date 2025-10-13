# Incident Postmortem Template

**Date:** [YYYY-MM-DD]  
**Incident ID:** [UNIQUE_ID]  
**Severity:** [Critical/High/Medium/Low]  
**Duration:** [Start Time] - [End Time] ([Total Duration])  
**Status:** [Resolved/Investigating/Ongoing]

---

## Executive Summary

_Brief, high-level description of the incident for stakeholders_

- **What happened:** [1-2 sentence summary]
- **Impact:** [User-facing impact]
- **Root cause:** [Brief technical cause]
- **Resolution:** [How it was fixed]

---

## Impact Assessment

### User Impact
- **Users affected:** [Number/percentage of users]
- **Service degradation:** [What functionality was impacted]
- **Geographic scope:** [If applicable]
- **User-visible symptoms:** [What users experienced]

### Business Impact
- **Tracks lost:** [Number of failed submissions/generations]
- **Revenue impact:** [Estimated lost payments/usage]
- **Reputation impact:** [User complaints, social media mentions]

### System Impact
- **Services affected:** [Database, ElevenLabs, Storage, etc.]
- **Data integrity:** [Any data loss or corruption]
- **Performance degradation:** [Specific metrics]

---

## Timeline

_All times in UTC. Include both automated alerts and manual actions._

| Time | Event | Action Taken | Actor |
|------|-------|-------------|-------|
| [HH:MM] | Incident begins | [Description] | System |
| [HH:MM] | Alert fired | [Alert name/source] | Monitoring |
| [HH:MM] | Investigation started | [Initial response] | [Person] |
| [HH:MM] | Root cause identified | [Finding] | [Person] |
| [HH:MM] | Fix deployed | [Solution] | [Person] |
| [HH:MM] | Incident resolved | [Verification] | [Person] |

---

## Root Cause Analysis

### Primary Cause
_The fundamental issue that caused the incident_

**Technical details:**
- [Specific system/component that failed]
- [Configuration issue, code bug, infrastructure problem]
- [Why existing safeguards didn't prevent it]

### Contributing Factors
_Secondary issues that made the incident worse or delayed resolution_

1. **[Factor 1]:** [Description and impact]
2. **[Factor 2]:** [Description and impact]
3. **[Factor 3]:** [Description and impact]

### What Worked Well
_Positive aspects of the incident response_

- [Quick detection/alerting]
- [Effective communication]
- [Successful rollback/mitigation]

---

## Resolution and Recovery

### Immediate Actions Taken
1. **[Action 1]:** [Time] - [Description and result]
2. **[Action 2]:** [Time] - [Description and result]
3. **[Action 3]:** [Time] - [Description and result]

### System State After Resolution
- **Health check status:** [All green/degraded/etc.]
- **Data consistency:** [Verified/restored]
- **Performance metrics:** [Back to normal/improved]
- **User experience:** [Fully restored]

---

## Action Items

### Immediate Actions (Within 24 hours)
- [ ] **[Action 1]** - Owner: [Name] - Due: [Date]
- [ ] **[Action 2]** - Owner: [Name] - Due: [Date]

### Short-term Actions (Within 1 week)
- [ ] **[Action 1]** - Owner: [Name] - Due: [Date]
- [ ] **[Action 2]** - Owner: [Name] - Due: [Date]

### Long-term Actions (Within 1 month)
- [ ] **[Action 1]** - Owner: [Name] - Due: [Date]
- [ ] **[Action 2]** - Owner: [Name] - Due: [Date]

---

## Prevention Measures

### Monitoring Improvements
- **New alerts needed:** [Specific metrics to monitor]
- **Alert threshold adjustments:** [What to change]
- **Dashboard enhancements:** [Additional visibility needed]

### Code/Configuration Changes
- **Input validation:** [Additional checks needed]
- **Error handling:** [Better error responses]
- **Circuit breakers:** [Failsafe mechanisms]
- **Rate limiting:** [Abuse prevention]

### Process Improvements
- **Deployment process:** [Additional safety checks]
- **Documentation:** [What needs to be updated]
- **Training:** [Knowledge gaps to address]
- **Emergency procedures:** [New runbook items]

### Infrastructure Improvements
- **Redundancy:** [Single points of failure to address]
- **Capacity:** [Resource limits to increase]
- **Backup systems:** [Fallback mechanisms needed]

---

## Lessons Learned

### Technical Lessons
1. **[Lesson 1]:** [What we learned about the system]
2. **[Lesson 2]:** [Technical insight gained]
3. **[Lesson 3]:** [Architecture/design consideration]

### Process Lessons
1. **[Lesson 1]:** [Communication/coordination insight]
2. **[Lesson 2]:** [Incident response improvement]
3. **[Lesson 3]:** [Monitoring/alerting lesson]

### Questions for Further Investigation
- [Question 1 that needs research]
- [Question 2 about system behavior]
- [Question 3 about architecture decisions]

---

## Supporting Evidence

### Logs and Traces
- **Error logs:** [Links to relevant log entries]
- **Performance traces:** [APM traces during incident]
- **Database queries:** [Slow/failed queries]

### Monitoring Data
- **Dashboards:** [Links to relevant charts]
- **Metrics:** [Key performance indicators during incident]
- **Alerts:** [Alert history and timeline]

### External Dependencies
- **Third-party status:** [ElevenLabs, Supabase, Vercel status]
- **Network issues:** [CDN, DNS, routing problems]
- **Browser/client issues:** [User-agent specific problems]

---

## Communication Log

### Internal Communication
- **Team notification:** [When and how team was alerted]
- **Status updates:** [Regular update schedule maintained]
- **Escalation:** [Management notification timeline]

### External Communication
- **User notification:** [Status page updates, social media]
- **Customer support:** [Support ticket volume and handling]
- **Partner notification:** [If applicable]

---

## Appendix

### System Configuration at Time of Incident
```yaml
Feature Flags:
  ENABLE_X402: true/false
  ENABLE_REAL_ELEVEN: true/false
  ENABLE_REQUEST_LOGGING: true/false

Environment:
  - Node version: [version]
  - Database version: [version]
  - Deployment: [commit hash]
  - Traffic volume: [requests/minute]
```

### Code Changes in Past 24 Hours
- **[Commit 1]:** [Brief description] - [Author] - [Time]
- **[Commit 2]:** [Brief description] - [Author] - [Time]

### Similar Past Incidents
- **[Date]:** [Brief description and link to postmortem]
- **[Date]:** [Brief description and link to postmortem]

---

## Review and Approval

**Prepared by:** [Name] - [Date]  
**Reviewed by:** [Name] - [Date]  
**Approved by:** [Name] - [Date]  

**Distribution:** [Team members, stakeholders to receive copy]

---

## Follow-up Actions Tracking

_Update this section as action items are completed_

| Action Item | Owner | Due Date | Status | Completion Date | Notes |
|-------------|-------|----------|--------|-----------------|-------|
| [Action 1] | [Name] | [Date] | [Open/In Progress/Done] | [Date] | [Notes] |
| [Action 2] | [Name] | [Date] | [Open/In Progress/Done] | [Date] | [Notes] |
# Proposal: working-day durations

Status: **proposal only, not built.** The engine (`engine.js`) is unchanged in this iteration on purpose. This document is for Josh and Kent to decide on before anyone writes code.

## Where we are

Durations and lags count **calendar days**. The calendar (weekends plus the holiday list, editable per schedule) does not move anything. It only flags a start or finish that lands on a non-working day, with a one-click fix such as "Extend to Mon Mar 1".

That was a deliberate choice early on, and it has real advantages:
- What you type is what you get.
- A "2-week review" is 14 days whoever counts it.
- A holiday added later never silently moves dates.

The cost shows in the new templates and in real schedules:
- Phases are entered in weeks, so they mostly line up. But a 10-day task that starts on a Wednesday finishes on a Friday that is really 8 working days later.
- Any edit upstream can push dozens of finishes onto weekends. That is the "8 new warnings" line in the impact card.
- The templates already work around this with a one-time snap to workdays at creation (`snapToWorkdays` in `templates.js`). It is a patch, not a model.

## Proposal

Add an optional **per-schedule** setting, `durationUnit`:

| Value | Meaning |
|---|---|
| `"calendar"` (default, and the value for every existing schedule) | Today's behavior, exactly. |
| `"working"` | Durations and lags count working days on the schedule's calendar. A 10-day task that starts Wednesday finishes the second Tuesday after it. Starts and finishes never land on a non-working day, so the weekend warnings go away. |

Rules in working mode:
1. **Start:** the next working day on or after the date the predecessors give, or after a hold date.
2. **Finish:** the start plus (duration − 1) working days.
3. **Milestones** (duration 0) sit on a working day.
4. **Lag** counts working days. Negative lag counts back.
5. **Locked dates** stay where they are. If one falls on a non-working day, it is flagged exactly as today. Nothing moves it.
6. **Holiday edits move dates.** That is the point of the mode, and the change-impact card reports it like any other edit ("Adding Jul 3 moved 6 activities a day later").

## Compatibility plan

- **Old schedules:** with no `durationUnit`, a schedule is `"calendar"`. Nothing in it changes, and older clients that ignore the field still read it correctly.
- **Switching modes is an explicit action** in Schedule settings, with a preview: "Switching keeps every start and finish where it is and recounts the durations in working days (a 14-day review becomes 10)." The conversion keeps dates, not numbers, so nobody's printed schedule shifts. It is one undoable edit, and it is saved to history.
- **Switching back** is the same in reverse: dates stay and the numbers are recounted.
- **Merge** (`merge.js`): `durationUnit` becomes one more project setting. If two people change it differently, it is a conflict the user resolves.
- **Exports:** the duration column header says "Days" or "Work days". CSV and Excel add a `Duration unit` column.
- **Templates** gain a unit too, so the "weeks" in the wizard map to 5 working days instead of 7 calendar days. `snapToWorkdays` stays for calendar-mode schedules only.

## Engine changes, sized

- **`schedule()`:** pass the calendar into date arithmetic: `addWork(n, k)` and `diffWork(a, b)`, with a fast path when there are no holidays.
- **Performance:** the change is linear in tasks × duration in the worst case, which is fine at a few hundred activities. A cumulative working-day index per schedule makes it O(1) per step if needed.
- **Tests:** a working-mode copy of every existing engine test, plus round-trip tests for the conversion (dates unchanged after switching to working and back).
- **Effort:** about 2–3 days with tests. The UI part is about 1 day: a setting, the conversion preview and the column header.

## Decisions needed

1. **Default for new schedules:** keep calendar for now, or switch to working? I'd keep calendar until a few PMs have tried working mode on a real project.
2. **Weekend work:** should a single activity be allowed to count calendar days inside a working-day schedule, for example a curing period or a 7-day-a-week fieldwork window? That would mean a per-task override. I'd leave it out of version 1 and see whether anyone asks.

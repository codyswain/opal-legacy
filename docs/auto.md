# Auto

The Auto tab is a screen for the Auto service, which runs agent threads on
another machine. Opal holds no sign-in and starts no run itself; the main
process makes every request (`src/main/auto/`), the page reads every answer
through `src/common/autoModel.ts`, and the tab is `src/renderer/features/auto/`.

## Sub-agents and modes

A thread's model can start sub-agents: threads of their own, on any model the
picker offers, each given one brief. They sit under their parent in the
sidebar, one step in, with a ring while they work, and never drag on their
own; a parent moves with its family, and archiving the parent takes them
along (Undo brings them all back). The step that started an agent opens its
thread, and the agent's header leads back with "Agent of". A finished agent
is never unread: its parent reads it.

The box's foot has a Mode picker beside the model, when the service names
modes: Solo, or Orchestrate, under which an Agents picker sets the default
model for the agents the thread starts. Both apply from the next turn. A new
thread remembers the last mode picked on this Mac.

The stand-in service in `src/tests/fixtures/auto/` fans a turn out to two
child threads when a message says "fan out"; `e2e/acceptance/auto-acceptance.mjs`
walks through it.

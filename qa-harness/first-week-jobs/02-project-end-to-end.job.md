---
id: 02-project-end-to-end
title: One project, from an empty screen to something you could show a board
account: run
files: handover
maxTurns: 200
---

You are an assistant planner. Your manager has handed you a corridor project and
told you to "get it into the system and bring something to the board meeting on
Thursday". The board is a room of elected officials. They are not planners.

Sign in at {{BASE_URL}} with {{EMAIL}} / {{PASSWORD}}.

Your predecessor left a folder of files on the shared drive. It is on your
computer at `handover/` inside your working directory:

- `corridor.geojson` — the alignment of the corridor the project is about
- `study-area.geojson` — the boundary the analysis is supposed to cover
- `projects.csv` — a list of the candidate projects with their costs

Nobody told you which of these the software wants, or in what order.

**What you need to have done by Thursday:**

1. The project exists in the software, with a name, a description a board member
   could read, and a cost.
2. The corridor and the study area are attached to it — you should be able to
   see the project's geography on a map.
3. Whatever the software knows about this project can be pulled together into
   one thing you could put in front of the board and hand out. Find that thing
   and produce it.

The test of whether you finished is not whether you clicked everything. It is
whether, at the end, you could open one screen or one document and talk a board
through this project without apologising for the software.

If you cannot get the files in, try every route the software offers before you
conclude it is impossible — and name in `absentText` the exact thing you looked
for and could not find.

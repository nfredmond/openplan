# Independent coordinator review, October 14

A read-only reviewer examined successive copied source snapshots. The review
identified three recovery defects before publication. A retry could read a new
engine observation despite a saved output selection. Output records could
accept a failed or running observation. Canonical orphan stage receipts could
reach another engine read without their original selector.

The coordinator now recovers and cross-checks the saved observation before
another read, checks each producer state, and refuses canonical orphan records.
Tests start from a genuinely unprepared lease and distinguish valid interrupted
temporary files from unexpected records. Targeted source faults challenge each
correction.

The final copied source and test snapshots contain no additional concrete
defect identified by the reviewer. The reviewer did not execute the code. This
review does not establish native, hosted, application receiver, browser or
scientific acceptance.

# The frozen607 build stage refuses memory capacity before webpack

October 16, 2026. The single admitted build stage terminates with exit one after 87.95 seconds. Its explicit refusal is `disk-memory-total-budget`. The webpack command never starts: there is no build intent, webpack command journal, build-result receipt or candidate `.next` directory. The failed request and unit journal remain retained. No retry or successor is admitted.

The source remains `607ee0895a79457181eda1d2ebbda1de4f2a4d40`, application tree `bed283ab0c937ead65378a2e9d26c177ceee6938`. Source/preparation review `a7c63b3e541e197f3b592756af6e3d6b6eef0ec1` governs that packet. Existing runtime-input hashes still match. Nothing here changes its source, guard or resource bounds.

## Initial capacity passes; the later guard refuses

After retiring the completed root-owned f0 preview, the unchanged capacity producer runs once in an owned 512 MiB, zero-swap, CPU50 unit. It returns zero and observes 13,030,060,032 available bytes against the existing 12,884,901,888-byte requirement. Disk free is 481,254,170,624 bytes against an 8,210,233,715-byte combined reservation. Those are observations at that producer's sampling point.

Root then admits the exact build once. Unit `openplan-pr330-disk-607ee0895-build` has invocation `aac9a50d5f0e41cc8a787a1f54e6577f`, a 10 GiB cap, zero swap and CPU50. The controller performs its source/helper checks before calling the capacity producer again. That later invocation refuses available memory below the same requirement. It does not record the actual failed available-byte value. Peak unit memory is 1,552,904,192 bytes, with swap peak zero. Peak is not current usage at the guard. The evidence does not establish whether controller allocations, another process or both caused the changed available-memory result.

The unit's terminal state is failed, PID zero, result exit-code and ExecMainStatus one. The parent observer successfully records that failure; its own successful recording is not a successful build. The original stage fence remains. Current host memory observations cannot authorize replay or retroactively satisfy the failed guard.

## Next work retains the failed boundary

A bounded reassessment must inspect actual capacity observations and the cost of the source/helper checks. Any later operation needs a fresh reviewed boundary that preserves this failed journal. It must retain the declared resource and host-reserve contract. This record changes neither threshold nor guard.

Other authorized work continues: source corrections for keeper terminal custody and decimal-scale handling, plus A0's independently reviewed first native-observation proposal. They do not rely on this build succeeding. No webpack, archive/start, browser/390px, artifact, hosted, release or v1 acceptance follows here. [evidence.json](evidence.json) pins the capacity, controller, unit and source inputs.

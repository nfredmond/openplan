/**
 * What Corridor Analysis answers, and what it does not.
 *
 * WHERE THIS CAME FROM. A tester was given a planner's brief — "your manager
 * wants to know what happens on this corridor: how much traffic, how much
 * driving, whether it is worth doing" — reached for the tool the app itself
 * points at, spent three steps setting it up, waited through the run, and got
 * demographics, mode share, reported collisions and accessibility/safety/equity
 * scores. No traffic figure. No miles driven. They filed it as a blocker, and in
 * their own words the tool "is very close to answering 'how much traffic would
 * this handle'" — which is exactly why the omission is expensive: it looks like
 * the right tool right up until the result arrives.
 *
 * THE FIX IS NOT TO PRODUCE A NUMBER. Corridor Analysis has no road network and
 * no demand model; a traffic figure from it would be invented. The honest fix is
 * to say so BEFORE a planner spends the setup, and again beside the result, and
 * to name what does answer the question.
 *
 * IT ALSO MUST NOT OVERSELL WHAT DOES. The travel-model lane produces a
 * screening-grade estimate that is known to run low; pointing at it is a
 * direction, not a promise. This sentence names where the number comes from and
 * what it costs to get, and claims nothing about its accuracy — the model run
 * carries its own grade, beside its own figures.
 */

/** One sentence pair, in one place, so the setup and the result cannot drift. */
export const CORRIDOR_ANALYSIS_ANSWERS =
  "This describes who and what is around the corridor today — people, jobs, how they travel now, and reported collisions — from open data.";

export const CORRIDOR_ANALYSIS_DOES_NOT_ANSWER =
  "It does not estimate traffic volumes or miles driven. Those come from a travel model run, which needs a road network and is a longer piece of work.";

/** Where a planner goes for the number this tool cannot give them. */
export const CORRIDOR_ANALYSIS_TRAFFIC_HREF = "/models";

/**
 * What the travel-model route costs, said on arrival.
 *
 * The other half of the link above. A tester followed the trail from "how much
 * traffic" to this lane and found a multi-step engineering workflow — upload a
 * road network, build scenarios, run, validate against field counts — and
 * described it as "not something achievable by a non-modeller in a week". They
 * were right, and that is not a defect in the workflow: estimating traffic
 * honestly is expert work and shortening it by hiding steps would produce a
 * number nobody could defend.
 *
 * What WAS a defect is that they discovered the shape of the job only after
 * committing to it. This says it on arrival.
 *
 * IT PROMISES NOTHING ABOUT ACCURACY. The estimate this route produces is
 * screening-grade and carries its own grade beside its own figures; repeating a
 * quality claim here would put a second, unqualified version of it in the
 * product.
 */
export const TRAVEL_MODEL_WHAT_IT_TAKES =
  "This is where a traffic or miles-driven estimate comes from, and it is the longer route. Before you start, choose a project: OpenPlan sets up its no-build and build scenarios, then the workers build one shared road network and run AequilibraE and ActivitySim separately. You still review the assumptions, failed links, disagreements, and checks against real counts before using the answer.";

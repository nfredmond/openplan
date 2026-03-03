import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  console.log("Setting up deterministic test workspace...");
  const { data: workspaces, error: wsErr } = await supabase.from("workspaces").select("*").limit(1);
  if (wsErr) {
    console.error("Failed to fetch workspaces:", wsErr);
    return;
  }
  
  if (!workspaces || workspaces.length === 0) {
    console.log("No workspaces found to test.");
    return;
  }
  
  const targetWs = workspaces[0];
  console.log(`Targeting workspace ID: ${targetWs.id} (current status: ${targetWs.subscription_status})`);

  const mutation = {
    plan: "professional",
    subscription_plan: "professional",
    subscription_status: "active",
    stripe_customer_id: "cus_test123",
    stripe_subscription_id: "sub_test123",
  };

  console.log("Applying mutation...");
  const { data: updateData, error: updateErr } = await supabase
    .from("workspaces")
    .update(mutation)
    .eq("id", targetWs.id)
    .select();

  if (updateErr) {
    console.error("Mutation failed:", updateErr);
  } else {
    console.log("Mutation succeeded! Workspace now:", updateData[0]);
  }
  
  console.log("Reverting...");
  await supabase
    .from("workspaces")
    .update({
      plan: targetWs.plan,
      subscription_plan: targetWs.subscription_plan,
      subscription_status: targetWs.subscription_status,
      stripe_customer_id: targetWs.stripe_customer_id,
      stripe_subscription_id: targetWs.stripe_subscription_id,
    })
    .eq("id", targetWs.id);
    
  console.log("Test completed successfully.");
}

main().catch(console.error);

// What pi's own skill loader says about the duplicate skill (AC7). `pi -p`
// prints no skill diagnostics (they are shown by the interactive mode), so the
// check asks pi's loader (the library function the resource loader calls) for
// the same inputs: the agent directory's skills, and the package's ./skills.
// Prints one line per diagnostic: `<type>: <message>`.
import { pathToFileURL } from "node:url";
const [lib, agentDir, packageSkills] = process.argv.slice(2);
const { loadSkills } = await import(pathToFileURL(lib).href);
const r = loadSkills({ cwd: process.cwd(), agentDir, skillPaths: [packageSkills], includeDefaults: true });
for (const d of r.diagnostics) console.log(`${d.type}: ${d.message}`);
console.log(`skills: ${r.skills.map((s) => s.name).join(",")}`);

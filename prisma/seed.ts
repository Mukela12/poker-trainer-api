import { PrismaClient } from "@prisma/client";
import { SPOTS, rangeEntriesFor } from "../src/poker";

const prisma = new PrismaClient();

async function main() {
  // Demo user
  const user = await prisma.user.upsert({
    where: { handle: "demo" },
    update: {},
    create: { handle: "demo" },
  });

  // Seed each training spot with its full 169-hand range chart.
  for (const s of SPOTS) {
    const spot = await prisma.spot.upsert({
      where: { key: s.key },
      update: { name: s.name, heroPosition: s.heroPosition, scenario: s.scenario, description: s.description },
      create: { key: s.key, name: s.name, heroPosition: s.heroPosition, scenario: s.scenario, description: s.description },
    });

    const entries = rangeEntriesFor(s.heroPosition);
    // Replace the chart wholesale so re-seeding is idempotent.
    await prisma.rangeEntry.deleteMany({ where: { spotId: spot.id } });
    await prisma.rangeEntry.createMany({
      data: entries.map((e) => ({ spotId: spot.id, hand: e.hand, action: e.action, frequency: e.frequency })),
    });
    const raises = entries.filter((e) => e.action === "raise").length;
    console.log(`  ${s.name}: ${entries.length} hands, ${raises} raise (${Math.round((raises / 169) * 100)}%)`);
  }

  console.log(`Seed complete. Demo user handle: ${user.handle}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

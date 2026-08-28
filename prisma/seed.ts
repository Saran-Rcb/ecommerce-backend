import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.product.createMany({
    data: [
      {
        name: "Men's T-Shirt",
        description: "Comfortable cotton t-shirt",
        price: 799,
        stock: 50,
        imageUrl: "/products/mens-tshirt.jpg",
      },
      {
        name: "Women's Dress",
        description: "Elegant casual dress",
        price: 1299,
        stock: 30,
        imageUrl: "/products/womens-dress.jpg",
      },
      {
        name: "Kids' Hoodie",
        description: "Warm and comfortable hoodie",
        price: 997,
        stock: 25,
        imageUrl: "/products/kids-hoodie.jpg",
      },
    ],
  });

  console.log("Products seeded successfully");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
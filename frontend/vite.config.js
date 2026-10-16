import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from https://ridwanlawala.github.io/ajochain/
export default defineConfig({ plugins: [react()], base: "/ajochain/" });

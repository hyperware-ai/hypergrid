#!/bin/bash
set -e

echo "Building HPN for PRODUCTION environment..."

# Copy production constants to their destinations
echo "Copying production constants..."
cp constants/production.rs operator/operator/src/constants.rs
cp constants/production.rs provider/provider/src/constants.rs
cp constants/production.ts operator/ui/src/constants.ts
cp constants/production.ts provider/ui/src/constants.ts

# Run the original build script
echo "Running main build script..."
./build.sh "$@"

echo "Production build complete!"
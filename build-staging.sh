#!/bin/bash
set -e

echo "Building HPN for STAGING environment..."

# Copy staging constants to their destinations
echo "Copying staging constants..."
cp constants/staging.rs operator/operator/src/constants.rs
cp constants/staging.rs provider/provider/src/constants.rs
cp constants/staging.ts operator/ui/src/constants.ts
cp constants/staging.ts provider/ui/src/constants.ts

# Run the original build script
echo "Running main build script..."
./build.sh "$@"

echo "Staging build complete!"
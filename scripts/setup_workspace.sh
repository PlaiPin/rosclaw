#!/bin/bash
# setup_workspace.sh - Cross-platform setup for RosClaw development environment
#
# DESCRIPTION:
#   This script performs the initial setup required for RosClaw development.
#   It supports both Ubuntu (native ROS2) and macOS (RoboStack with mamba).
#   The script installs dependencies, creates the appropriate environment,
#   and builds all ROS2 packages. Run this script once before using the
#   activate_workspace.sh script for daily development.
#
# USAGE:
#   ./scripts/setup_workspace.sh [options]
#
# OPTIONS:
#   -e, --env-name NAME     Name of the environment to create (default: ros_env)
#   -d, --ros-distro DISTRO ROS2 distribution (default: humble)
#   -h, --help              Show this help message
#
# EXAMPLES:
#   # Use defaults (ros_env, jazzy)
#   ./scripts/setup_workspace.sh
#
#   # Custom environment name
#   ./scripts/setup_workspace.sh --env-name my_ros_env
#
#   # Different ROS2 distro
#   ./scripts/setup_workspace.sh --ros-distro humble
#
# PLATFORMS SUPPORTED:
#   - Ubuntu/Debian: Native ROS2 installation with apt + venv
#   - macOS: RoboStack with mamba/conda environment
#
# WHAT IT DOES:
#   1. Detects platform (Ubuntu vs macOS)
#   2. Installs platform-specific infrastructure
#   3. Creates appropriate environment (venv with --system-site-packages vs conda)
#   4. Installs ROS2, rosbridge_library, and all required development tools
#   5. Installs agent-specific pip dependencies (aiortc, websockets)
#   6. Builds all ROS2 packages in ros2_ws
#   7. Validates the complete setup

set -e  # Exit on any error

# Default values
DEFAULT_ENV_NAME="ros_env"
DEFAULT_ROS_DISTRO="humble"
ENV_NAME=""
ROS_DISTRO=""

# Find the repository root
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ROS2_WS_PATH="$REPO_ROOT/ros2_ws"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Help function
show_help() {
    cat << EOF
RosClaw Development Environment Setup

USAGE:
    $0 [options]

OPTIONS:
    -e, --env-name NAME     Name of the environment to create (default: $DEFAULT_ENV_NAME)
    -d, --ros-distro DISTRO ROS2 distribution (default: $DEFAULT_ROS_DISTRO)
    -h, --help              Show this help message

EXAMPLES:
    # Use defaults
    $0

    # Custom environment name
    $0 --env-name my_ros_env

    # Different ROS2 distribution
    $0 --ros-distro humble

SUPPORTED PLATFORMS:
    - Ubuntu/Debian: Native ROS2 with apt + Python venv
    - macOS: RoboStack with mamba/conda environment

SUPPORTED ROS2 DISTRIBUTIONS:
    - jazzy (default)
    - humble
    - kilted
EOF
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -e|--env-name)
                ENV_NAME="$2"
                shift 2
                ;;
            -d|--ros-distro)
                ROS_DISTRO="$2"
                shift 2
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done

    # Set defaults if not specified
    ENV_NAME="${ENV_NAME:-$DEFAULT_ENV_NAME}"
    ROS_DISTRO="${ROS_DISTRO:-$DEFAULT_ROS_DISTRO}"
}

# Platform detection
detect_platform() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        PLATFORM="macos"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if command -v apt &> /dev/null; then
            PLATFORM="ubuntu"
        else
            log_error "Linux platform detected but apt not found. Only Ubuntu/Debian supported."
            exit 1
        fi
    else
        log_error "Unsupported platform: $OSTYPE"
        log_error "Supported platforms: macOS, Ubuntu/Debian"
        exit 1
    fi
}

# Check and install mamba/conda if needed (for macOS)
check_mamba() {
    if ! command -v mamba &> /dev/null; then
        if ! command -v conda &> /dev/null; then
            log_info "Neither mamba nor conda found. Installing miniforge automatically..."

            local installer="Miniforge3-MacOSX-$(uname -m).sh"
            local url="https://github.com/conda-forge/miniforge/releases/latest/download/$installer"

            log_info "Downloading miniforge installer..."
            if ! curl -L -O "$url"; then
                log_error "Failed to download miniforge installer"
                exit 1
            fi

            log_info "Installing miniforge..."
            if ! bash "$installer" -b -p "$HOME/miniforge3"; then
                log_error "Failed to install miniforge"
                exit 1
            fi

            rm -f "$installer"
            eval "$($HOME/miniforge3/bin/conda shell.$(basename $SHELL) hook)"
            log_success "Miniforge installed successfully"
        else
            log_warning "conda found but mamba not available. Installing mamba..."
            conda install mamba -c conda-forge -y
        fi
    fi
}

# Validate ROS2 distribution support
validate_ros_distro() {
    local supported_distros=("humble" "jazzy" "kilted")
    local distro_supported=false

    for supported in "${supported_distros[@]}"; do
        if [[ "$ROS_DISTRO" == "$supported" ]]; then
            distro_supported=true
            break
        fi
    done

    if [[ "$distro_supported" == false ]]; then
        log_error "ROS2 distribution '$ROS_DISTRO' is not supported"
        log_error "Supported distributions: ${supported_distros[*]}"
        exit 1
    fi
}

# Check if already in conda environment
check_conda_env_active() {
    if [[ -n "$CONDA_DEFAULT_ENV" ]]; then
        log_warning "Already in conda environment: $CONDA_DEFAULT_ENV"
        if [[ "$CONDA_DEFAULT_ENV" == "$ENV_NAME" ]]; then
            log_info "Already in target environment '$ENV_NAME', continuing setup..."
            return 0
        else
            log_warning "In different environment. Will deactivate and switch to '$ENV_NAME'"
            conda deactivate 2>/dev/null || true
            mamba deactivate 2>/dev/null || true
        fi
    fi
    return 1
}

# Ubuntu setup function
setup_ubuntu() {
    log_info "Setting up Ubuntu environment..."

    # Step 1: Install system dependencies
    log_info "[1/5] Installing system dependencies..."
    sudo apt update
    sudo apt install -y \
        python3-dev \
        python3-venv \
        python3-pip \
        build-essential \
        cmake \
        pkg-config \
        curl \
        gnupg2 \
        lsb-release \
        software-properties-common

    # Step 2: Install ROS2 and required packages
    log_info "[2/5] Setting up ROS2 $ROS_DISTRO..."

    if ! command -v ros2 &> /dev/null; then
        log_info "Installing ROS2 $ROS_DISTRO..."

        sudo curl -sSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.key -o /usr/share/keyrings/ros-archive-keyring.gpg
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/ros-archive-keyring.gpg] http://packages.ros.org/ros2/ubuntu $(. /etc/os-release && echo $UBUNTU_CODENAME) main" | sudo tee /etc/apt/sources.list.d/ros2.list > /dev/null

        sudo apt update
    else
        log_success "ROS2 base already installed"
    fi

    log_info "Ensuring all required ROS2 packages are installed..."
    sudo apt install -y \
        ros-$ROS_DISTRO-ros-base \
        ros-$ROS_DISTRO-rosbridge-library \
        python3-colcon-common-extensions

    log_success "All required ROS2 packages installed"

    # Step 3: Create Python virtual environment with system site-packages
    # This is critical: rclpy and rosbridge_library are system-installed via apt.
    # The venv must inherit them via --system-site-packages.
    log_info "[3/5] Setting up Python virtual environment..."
    VENV_PATH="$REPO_ROOT/$ENV_NAME"

    if [ -d "$VENV_PATH" ]; then
        log_warning "Virtual environment already exists at: $VENV_PATH"
    else
        log_info "Creating virtual environment at: $VENV_PATH (with --system-site-packages)"
        python3 -m venv "$VENV_PATH" --system-site-packages
        log_success "Virtual environment created"
    fi

    # Step 4: Install agent-specific Python packages
    log_info "[4/5] Installing Python packages for rosclaw_agent..."
    source "$VENV_PATH/bin/activate"
    pip install --upgrade pip
    pip install aiortc websockets
    log_success "Python packages installed (aiortc, websockets)"

    # Step 5: Build ROS2 packages
    log_info "[5/5] Building ROS2 packages..."
    cd "$ROS2_WS_PATH"
    source /opt/ros/$ROS_DISTRO/setup.bash
    colcon build --symlink-install
    log_success "ROS2 packages built successfully"
}

# macOS setup function
setup_macos() {
    log_info "Setting up macOS environment with RoboStack..."

    # Step 1: Check mamba installation
    log_info "[1/5] Checking mamba installation..."
    check_mamba
    log_success "Mamba is available"

    # Step 2: Create conda environment
    log_info "[2/5] Setting up conda environment '$ENV_NAME'..."

    local already_in_target_env=false
    if check_conda_env_active; then
        already_in_target_env=true
    fi

    if mamba env list | grep -q "^$ENV_NAME "; then
        log_warning "Environment '$ENV_NAME' already exists"
        if [[ "$already_in_target_env" == false ]]; then
            log_info "Activating existing environment..."
            eval "$(mamba shell hook)"
            mamba activate "$ENV_NAME"
        fi
    else
        log_info "Creating new environment '$ENV_NAME'..."
        mamba create -n "$ENV_NAME" -y
        eval "$(mamba shell hook)"
        mamba activate "$ENV_NAME"
    fi

    conda config --env --add channels conda-forge
    conda config --env --remove channels defaults 2>/dev/null || true
    conda config --env --add channels robostack-$ROS_DISTRO

    # Step 3: Install ROS2 and development tools
    log_info "[3/5] Installing ROS2 $ROS_DISTRO and development tools..."
    mamba install -y \
        ros-$ROS_DISTRO-ros-base \
        ros-$ROS_DISTRO-rosbridge-library \
        compilers \
        cmake \
        pkg-config \
        make \
        ninja \
        colcon-common-extensions \
        python \
        pip

    log_success "ROS2 and development tools installed"

    # Step 4: Install agent-specific Python packages
    log_info "[4/5] Installing Python packages for rosclaw_agent..."
    pip install aiortc websockets
    log_success "Python packages installed (aiortc, websockets)"

    # Deactivate and reactivate to ensure proper ROS setup
    mamba deactivate
    mamba activate "$ENV_NAME"

    # Step 5: Build ROS2 packages
    log_info "[5/5] Building ROS2 packages..."
    cd "$ROS2_WS_PATH"
    colcon build --symlink-install
    log_success "ROS2 packages built successfully"
}

# Validation function
validate_setup() {
    log_info "Validating setup..."

    cd "$ROS2_WS_PATH"

    if [[ "$PLATFORM" == "macos" ]]; then
        eval "$(mamba shell hook)"
        mamba activate "$ENV_NAME"
    else
        source /opt/ros/$ROS_DISTRO/setup.bash
        source "$REPO_ROOT/$ENV_NAME/bin/activate"
    fi

    # Source workspace
    if [ -f "install/setup.bash" ]; then
        source install/setup.bash
        log_success "Workspace sourced successfully"
    else
        log_error "Workspace build failed - install/setup.bash not found"
        return 1
    fi

    # Test ROS2 functionality
    if command -v ros2 &> /dev/null; then
        log_success "ROS2 command available"
    else
        log_error "ROS2 command not available"
        return 1
    fi

    # Test if our packages are available
    local all_found=true
    for pkg in rosclaw_msgs rosclaw_discovery rosclaw_agent; do
        if ros2 pkg list 2>/dev/null | grep -q "$pkg"; then
            log_success "Package found: $pkg"
        else
            log_warning "Package not found: $pkg"
            all_found=false
        fi
    done

    # Test agent Python dependencies
    if python3 -c "import aiortc; import websockets" 2>/dev/null; then
        log_success "Agent Python dependencies available (aiortc, websockets)"
    else
        log_warning "Agent Python dependencies missing (aiortc or websockets)"
    fi

    # Test rosbridge_library availability
    if python3 -c "from rosbridge_library.internal.ros_loader import get_message_class" 2>/dev/null; then
        log_success "rosbridge_library available"
    else
        log_warning "rosbridge_library not available"
    fi

    return 0
}

# Main execution
main() {
    echo "======================================"
    echo "RosClaw Development Setup"
    echo "======================================"
    echo ""

    parse_args "$@"
    detect_platform

    if [[ "$PLATFORM" == "macos" ]]; then
        validate_ros_distro
    fi

    log_info "Platform detected: $PLATFORM"
    log_info "Environment name: $ENV_NAME"
    log_info "ROS2 distribution: $ROS_DISTRO"
    log_info "Repository root: $REPO_ROOT"

    if [[ "$PLATFORM" == "macos" && -n "$CONDA_DEFAULT_ENV" ]]; then
        log_info "Current conda environment: $CONDA_DEFAULT_ENV"
    fi
    echo ""

    case $PLATFORM in
        ubuntu)
            setup_ubuntu
            ;;
        macos)
            setup_macos
            ;;
        *)
            log_error "Unsupported platform: $PLATFORM"
            exit 1
            ;;
    esac

    echo ""

    if validate_setup; then
        log_success "Setup validation passed!"
    else
        log_error "Setup validation failed!"
        exit 1
    fi

    echo ""
    echo "Setup complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Activate your development environment for daily use:"
    echo "     source $REPO_ROOT/scripts/activate_workspace.sh"
    echo ""
    echo "  2. Test discovery node:"
    echo "     ros2 run rosclaw_discovery discovery_node"
    echo ""
    echo "  3. Test agent node (requires signaling server):"
    echo "     ROSCLAW_SIGNALING_URL=ws://localhost:8000 ros2 run rosclaw_agent agent_node"
    echo ""
}

main "$@"

cmake_minimum_required(VERSION 3.8)
project(rosclaw_msgs)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
find_package(std_msgs REQUIRED)
find_package(rosidl_default_generators REQUIRED)

# TODO: Add custom message/service files when defined
# rosidl_generate_interfaces(${PROJECT_NAME}
#   "msg/CapabilityManifest.msg"
#   "srv/GetCapabilities.srv"
#   DEPENDENCIES std_msgs
# )

ament_package()

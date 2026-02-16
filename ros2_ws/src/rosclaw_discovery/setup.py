from setuptools import find_packages, setup

package_name = "rosclaw_discovery"

setup(
    name=package_name,
    version="0.0.1",
    packages=find_packages(exclude=["test"]),
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/" + package_name]),
        ("share/" + package_name, ["package.xml"]),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="PlaiPin",
    maintainer_email="team@plaipin.com",
    description="ROS2 capability discovery node for RosClaw",
    license="Apache-2.0",
    tests_require=["pytest"],
    entry_points={
        "console_scripts": [
            "discovery_node = rosclaw_discovery.discovery_node:main",
        ],
    },
)

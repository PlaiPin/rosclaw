from setuptools import setup

package_name = "rosclaw_follow_me"

setup(
    name=package_name,
    version="0.0.1",
    packages=[package_name],
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/" + package_name]),
        ("share/" + package_name, ["package.xml"]),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="PlaiPin",
    maintainer_email="team@plaipin.com",
    description="Follow Me mission: person tracking and follower control for RosClaw",
    license="Apache-2.0",
    tests_require=["pytest"],
    entry_points={
        "console_scripts": [
            "follow_me_node = rosclaw_follow_me.follow_me_node:main",
        ],
    },
)
